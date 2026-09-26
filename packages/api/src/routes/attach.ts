import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ScreenStateDetector, loadManifest } from '@aeos/runner';
import type { ApiContext } from '../server.js';
import { statusTrackerFor } from '../status.js';

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

    // P2.M10 screen-state detection (herdr manifests): a human running the
    // harness interactively in the takeover shell still drives the agent's
    // attention status — permission prompt → blocked, prompt box → done.
    const manifest = loadManifest(agent.harness.provider, path.join(ctx.home, 'agent-detection'));
    const tracker = statusTrackerFor(ctx.home, ctx.bus);
    const detector =
      manifest === undefined
        ? undefined
        : new ScreenStateDetector({
            manifest,
            onChange: (change) => {
              if (change.state === 'unknown') return;
              tracker.set({ workspaceId: agent.workspaceId, id: agent.id }, change.state === 'idle' ? 'done' : change.state, {
                via: 'screen',
                sessionId: id,
                rule: change.rule,
                reason: `screen rule ${change.rule ?? '?'}`,
              });
            },
          });

    let bridge;
    try {
      bridge = await ctx.attachPty(id, (data) => {
        detector?.write(data);
        if (socket.readyState === socket.OPEN) socket.send(data);
      });
    } catch {
      detector?.dispose();
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
        detector?.resize(control.cols, control.rows);
        return;
      }
      if (control?.type === 'release') {
        bridge.release();
        closeWith(1000, 'released');
        return;
      }
      bridge.input(text);
    });
    socket.on('close', () => {
      bridge.release();
      detector?.dispose();
    });
  });
}
