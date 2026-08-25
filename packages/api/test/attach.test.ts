import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  AgentConfigSchema,
  EffectivePolicySchema,
  type AgentConfig,
  type EffectivePolicy,
} from '@aeos/contracts';
import { createApiServer, listenApi, type PtyBridge, type PtyHandle } from '../src/server.js';

/**
 * P2.M5.T2: the WebSocket attach endpoint pipes bytes between browser and
 * the supervisor's PTY handle — and refuses non-allow tiers outright
 * (least privilege; default posture = confirm → refused).
 */

let home: string;
let app: FastifyInstance | undefined;

const agent = AgentConfigSchema.parse({
  id: 'ada',
  workspaceId: 'ws1',
  name: 'Ada',
  harness: { provider: 'claude-code' },
  credentialProfileId: 'cp-default',
});

const allowPolicy: EffectivePolicy = EffectivePolicySchema.parse({
  tiers: { execute_commands: 'allow' },
  confirmTimeoutSeconds: 300,
});

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-api-attach-'));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(home, { recursive: true, force: true });
});

function wsUrl(address: string, sessionId: string): string {
  return `ws://${address.replace('http://', '')}/v1/sessions/${sessionId}/attach`;
}

async function waitOpen(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
  });
}

async function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve({ code: -1, reason: '' });
    ws.addEventListener(
      'close',
      (event) => resolve({ code: event.code, reason: event.reason }),
      { once: true },
    );
  });
}

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('session PTY attach endpoint (P2.M5.T2)', () => {
  it('pipes bytes both ways and tears the bridge down on release', async () => {
    let typedByBrowser = '';
    let resized: [number, number] | undefined;
    let released = false;
    const bridge: PtyHandle = {
      input: (data) => {
        typedByBrowser += data;
      },
      resize: (cols, rows) => {
        resized = [cols, rows];
      },
      release: () => {
        released = true;
      },
    };
    app = await createApiServer({
      home,
      adapterFor: () => {
        throw new Error('unused in attach tests');
      },
      credentialFor: () => {
        throw new Error('unused in attach tests');
      },
      resolveAgent: () => agent,
      policyFor: async () => allowPolicy,
      attachPty: async (sessionId, onOutput) => {
        expect(sessionId).toBe('s1');
        onOutput('hello-from-runner');
        return bridge;
      },
    });
    const address = await listenApi(app, { port: 0 });

    const ws = new WebSocket(wsUrl(address, 's1'));
    await waitOpen(ws);
    let fromRunner = '';
    ws.addEventListener('message', (event) => {
      fromRunner += event.data as string;
    });
    await waitFor(() => fromRunner.includes('hello-from-runner'));

    ws.send('typed-bytes\r');
    await waitFor(() => typedByBrowser.includes('typed-bytes'));

    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 30 }));
    await waitFor(() => resized?.[0] === 120);

    ws.send(JSON.stringify({ type: 'release' }));
    await waitFor(() => released);
    ws.close();
  });

  it('refuses tiers other than allow with a typed close', async () => {
    app = await createApiServer({
      home,
      adapterFor: () => {
        throw new Error('unused');
      },
      credentialFor: () => {
        throw new Error('unused');
      },
      resolveAgent: () => agent,
      policyFor: async () =>
        EffectivePolicySchema.parse({
          tiers: { execute_commands: 'confirm' },
          confirmTimeoutSeconds: 300,
        }),
      attachPty: async () => {
        throw new Error('must not be reached under confirm tier');
      },
    });
    const address = await listenApi(app, { port: 0 });

    const ws = new WebSocket(wsUrl(address, 's1'));
    const close = await waitClose(ws);
    expect(close.code).toBe(1008);
    expect(close.reason).toContain('policy');
  });

  it('refuses unknown sessions', async () => {
    app = await createApiServer({
      home,
      adapterFor: () => {
        throw new Error('unused');
      },
      credentialFor: () => {
        throw new Error('unused');
      },
      resolveAgent: () => undefined,
      policyFor: async () => allowPolicy,
      attachPty: async () => {
        throw new Error('must not be reached for unknown sessions');
      },
    });
    const address = await listenApi(app, { port: 0 });

    const ws = new WebSocket(wsUrl(address, 'nope'));
    const close = await waitClose(ws);
    expect(close.code).toBe(1008);
  });

  it('absent attach capability closes with a server error', async () => {
    app = await createApiServer({
      home,
      adapterFor: () => {
        throw new Error('unused');
      },
      credentialFor: () => {
        throw new Error('unused');
      },
      resolveAgent: () => agent,
      policyFor: async () => allowPolicy,
    });
    const address = await listenApi(app, { port: 0 });

    const ws = new WebSocket(wsUrl(address, 's1'));
    const close = await waitClose(ws);
    expect(close.code).toBe(1011);
  });
});

// keep the import used for typing clarity even if tree-shaken above
void ({} as PtyBridge);
void ({} as AgentConfig);
