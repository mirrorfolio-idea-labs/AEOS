import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../server.js';

/**
 * `GET /v1/sessions/:id/attach` (WebSocket only — spec §14): pipes bytes
 * between the browser terminal and a live runner's PTY.
 *
 * Least privilege from day one: the session's agent must resolve and its
 * effective policy must map `execute_commands` to `allow` — any other tier
 * gets a typed close (default posture = confirm → refused). Browser→daemon
 * frames are raw keystrokes; two JSON control frames are reserved:
 * `{type:"resize",cols,rows}` and `{type:"release"}`.
 */
export function registerAttachRoute(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/v1/sessions/:id/attach', { websocket: true }, async (socket, request) => {
    const closeWith = (code: number, reason: string): void => {
      try {
        socket.close(code, reason);
      } catch {
        // already closing — nothing to do
      }
    };
    const { id } = request.params as { id: string };

    if (ctx.attachPty === undefined || ctx.resolveAgent === undefined) {
      return closeWith(1011, 'pty attach unavailable');
    }
    const agent = ctx.resolveAgent(id);
    if (agent === undefined) return closeWith(1008, 'unknown_session');
    if (ctx.policyFor !== undefined) {
      const policy = await ctx.policyFor(agent);
      if (policy.tiers['execute_commands'] !== 'allow') {
        return closeWith(1008, 'policy_denied: execute_commands must be allow to attach');
      }
    }

    let bridge;
    try {
      bridge = await ctx.attachPty(id, (data) => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      });
    } catch {
      return closeWith(1011, 'no live runner for session');
    }

    socket.on('message', (raw: unknown) => {
      const text = String(raw);
      let control: { type?: string; cols?: number; rows?: number } | undefined;
      if (text.startsWith('{')) {
        try {
          control = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
        } catch {
          control = undefined; // shell input that merely looks like JSON
        }
      }
      if (control?.type === 'resize' && typeof control.cols === 'number' && typeof control.rows === 'number') {
        bridge.resize(control.cols, control.rows);
        return;
      }
      if (control?.type === 'release') {
        bridge.release();
        closeWith(1000, 'released');
        return;
      }
      bridge.input(text);
    });
    socket.on('close', () => bridge.release());
  });
}
