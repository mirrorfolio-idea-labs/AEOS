import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { AeosEvent } from '@aeos/contracts';
import { AeosClient } from '@aeos/sdk';

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');

interface DaemonHandle {
  child: ChildProcess;
  client: AeosClient;
  baseUrl: string;
  home: string;
}

const cleanups: Array<() => Promise<void> | void> = [];

// pid-derived: parallel vitest files must never fight over fixed ports
const portBase = 41000 + (process.pid % 20000);

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function startDaemon(home: string, port: number, extraEnv: Record<string, string> = {}): Promise<DaemonHandle> {
  const child = spawn(process.execPath, [MAIN, 'run'], {
    env: {
      PATH: process.env['PATH'] ?? '',
      AEOS_HOME: home,
      AEOS_PORT: String(port),
      AEOS_PROVIDER: 'fake',
      AEOS_FAKE_PACE_MS: '20',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  cleanups.push(async () => {
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  });
  const stderr = { text: '' };
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr.text += chunk.toString();
  });
  const client = new AeosClient({ baseUrl: `http://127.0.0.1:${port}` });
  for (let i = 0; i < 100; i++) {
    try {
      await client.health();
      return { child, client, baseUrl: `http://127.0.0.1:${port}`, home };
    } catch {
      await delay(50);
    }
  }
  throw new Error(`daemon boot timeout:\n${stderr.text}`);
}

async function seedObjective(client: AeosClient): Promise<void> {
  await client.createWorkspace({ id: 'ws1', name: 'WS' });
  await client.createAgent({
    id: 'ada',
    workspaceId: 'ws1',
    name: 'Ada',
    harness: { provider: 'claude-code', featureToggles: { plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false } },
    credentialProfileId: 'byok',
  });
  await client.createObjective({
    workspaceId: 'ws1',
    agentId: 'ada',
    id: 'obj1',
    title: 'Default-posture run',
    tasks: [{ id: 'T1', title: 'Run the fake' }],
  });
}

// the default fake fixture performs a bash tool call -> execute_commands ->
// confirm under the untouched default posture, so EVERY scenario parks.
describe('approval flow end-to-end (P2.M1.T4)', () => {
  it('approve: parked request resolves, objective completes', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-approval-approve-'));
    const daemon = await startDaemon(home, portBase);
    const { client } = daemon;
    await seedObjective(client);

    await client.startObjective('ws1', 'ada', 'obj1');
    let pending;
    for (let i = 0; i < 200 && (pending = (await client.listApprovals())[0]) === undefined; i++) {
      await delay(25);
    }
    expect(pending, 'expected a parked approval request').toBeDefined();
    expect(pending!.tier).toBe('execute_commands');

    const resolved = await client.resolveApproval(pending!.requestId, 'approve');
    expect(resolved.resolved).toBe(true);

    await waitForCompleted(client);
  }, 20_000);

  it('deny: blocked action, objective still finishes', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-approval-deny-'));
    const daemon = await startDaemon(home, portBase + 1);
    const { client } = daemon;
    await seedObjective(client);

    const events: AeosEvent[] = [];
    const stream = client.events({});
    const reader = (async () => {
      for await (const event of stream) {
        events.push(event);
        if (event.type === 'session.completed') break;
      }
    })();

    await client.startObjective('ws1', 'ada', 'obj1');
    let pending;
    for (let i = 0; i < 200 && (pending = (await client.listApprovals())[0]) === undefined; i++) {
      await delay(25);
    }
    await client.resolveApproval(pending!.requestId, 'deny');
    await waitForCompleted(client);

    await Promise.race([reader, delay(3_000)]);
    const types = events.map((e) => e.type);
    expect(types).toContain('approval.request');
    expect(types).toContain('approval.resolved');
    expect(types).toContain('policy.blocked');
    const resolved = events.find((e) => e.type === 'approval.resolved') as
      | Extract<AeosEvent, { type: 'approval.resolved' }>
      | undefined;
    expect(resolved?.payload.decision).toBe('denied');
  }, 20_000);

  it('expiry: unanswered requests auto-deny (AEOS_APPROVAL_TIMEOUT_MS)', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-approval-expiry-'));
    const daemon = await startDaemon(home, portBase + 2, { AEOS_APPROVAL_TIMEOUT_MS: '400' });
    const { client } = daemon;
    await seedObjective(client);

    const events: AeosEvent[] = [];
    const stream = client.events({});
    const reader = (async () => {
      for await (const event of stream) {
        events.push(event);
        if (event.type === 'session.completed') break;
      }
    })();

    await client.startObjective('ws1', 'ada', 'obj1');
    for (let i = 0; i < 200 && (await client.listApprovals()).length === 0; i++) {
      await delay(25);
    }
    // no human answers — the timeout must deny by itself
    await waitForCompleted(client);
    await Promise.race([reader, delay(3_000)]);
    const resolved = events.find((e) => e.type === 'approval.resolved') as
      | Extract<AeosEvent, { type: 'approval.resolved' }>
      | undefined;
    expect(resolved?.payload.decision).toBe('expired');
    expect((await client.listApprovals())).toHaveLength(0);
  }, 20_000);

  async function waitForCompleted(client: AeosClient): Promise<void> {
    for (let i = 0; i < 300; i++) {
      const status = await client.objectiveStatus('ws1', 'ada', 'obj1');
      if (!status.running && status.tasks[0]?.status !== 'in_progress') return;
      await delay(25);
    }
    throw new Error('objective never finished');
  }
});
