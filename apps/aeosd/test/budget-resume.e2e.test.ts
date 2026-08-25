import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AeosClient, type ObjectiveStatus } from '@aeos/sdk';

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');

interface DaemonHandle {
  child: ChildProcess;
  client: AeosClient;
  home: string;
}

const cleanups: Array<() => Promise<void> | void> = [];
const portBase = 44000 + (process.pid % 20000);

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

/**
 * Budget tests need the run to REACH its cost events, so the fixture home
 * allows execute_commands explicitly (P2.M1 default posture otherwise parks
 * every fake session on an approval long before spend happens).
 */
async function allowExecute(home: string): Promise<void> {
  const wsDir = path.join(home, 'workspaces', 'ws1');
  await mkdir(wsDir, { recursive: true });
  await writeFile(path.join(wsDir, 'policy.yaml'), 'tiers:\n  execute_commands: allow\n');
}

async function startDaemon(home: string, port: number): Promise<DaemonHandle> {
  const child = spawn(process.execPath, [MAIN, 'run'], {
    env: {
      PATH: process.env['PATH'] ?? '',
      AEOS_HOME: home,
      AEOS_PORT: String(port),
      AEOS_PROVIDER: 'fake',
      AEOS_FAKE_PACE_MS: '15',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  cleanups.push(async () => {
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  });
  const client = new AeosClient({ baseUrl: `http://127.0.0.1:${port}` });
  for (let i = 0; i < 100; i++) {
    try {
      await client.health();
      return { child, client, home };
    } catch {
      await delay(50);
    }
  }
  throw new Error('daemon boot timeout');
}

async function waitSettled(client: AeosClient): Promise<ObjectiveStatus> {
  for (let i = 0; i < 300; i++) {
    const status = await client.objectiveStatus('ws1', 'ada', 'obj-cap');
    if (!status.running) return status;
    await delay(25);
  }
  throw new Error('objective never settled');
}

describe('budget resume-with-increase (P2.M2.T2)', () => {
  it('hard-stop parks without burning a strike; raising the cap completes the objective', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-budget-resume-'));
    const daemon = await startDaemon(home, portBase + 10);
    const { client } = daemon;

    await client.createWorkspace({ id: 'ws1', name: 'WS' });
    await allowExecute(home);
    await client.createAgent({
      id: 'ada',
      workspaceId: 'ws1',
      name: 'Ada',
      harness: { provider: 'claude-code', featureToggles: { plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false } },
      credentialProfileId: 'cp-default',
    });
    await client.createObjective({
      workspaceId: 'ws1',
      agentId: 'ada',
      id: 'obj-cap',
      title: 'Capped run',
      tasks: [{ id: 'T1', title: 'spendy task' }],
      budgetUsd: 0.001,
    });

    // first run: the fake's $0.02 crosses the $0.01 cap → hard-stop
    await client.startObjective('ws1', 'ada', 'obj-cap');
    const stopped = await waitSettled(client);
    expect(stopped.tasks[0]?.status).toBe('pending'); // parked, not blocked

    // negative control: restarting WITHOUT a raise pauses again — no burn
    await client.startObjective('ws1', 'ada', 'obj-cap');
    const stoppedAgain = await waitSettled(client);
    expect(stoppedAgain.tasks[0]?.status).toBe('pending');

    // resume-with-increase: rewrite the cap file and re-start
    const objectiveYaml = path.join(
      home,
      'workspaces',
      'ws1',
      'agents',
      'ada',
      'objectives',
      'obj-cap',
      'objective.yaml',
    );
    const original = await readFile(objectiveYaml, 'utf8');
    await writeFile(objectiveYaml, original.replace('budgetUsd: 0.001', 'budgetUsd: 1'));
    await client.startObjective('ws1', 'ada', 'obj-cap');
    const finished = await waitSettled(client);
    expect(finished.tasks[0]?.status).toBe('completed');

    // the checkpoint history proves the stop happened with zero strikes
    // zero-strike proof: had the hard-stop consumed an attempt, completion
    // would read "attempt 2"; it reads attempt 1.
    const checkpointsDir = path.join(path.dirname(objectiveYaml), 'checkpoints');
    const checkpointText = await readFile(path.join(checkpointsDir, 'T1.yaml'), 'utf8');
    expect(checkpointText).toContain('status: completed');
    expect(checkpointText).toContain('attempts: 1');
    expect(checkpointText).toContain('completed on attempt 1');
  }, 30_000);

  it('runaway loop cannot outspend its cap across repeated restarts (flagship)', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-budget-runaway-'));
    const daemon = await startDaemon(home, portBase + 11);
    const { client } = daemon;

    await client.createWorkspace({ id: 'ws1', name: 'WS' });
    await allowExecute(home);
    await client.createAgent({
      id: 'ada',
      workspaceId: 'ws1',
      name: 'Ada',
      harness: { provider: 'claude-code', featureToggles: { plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false } },
      credentialProfileId: 'cp-default',
    });
    await client.createObjective({
      workspaceId: 'ws1',
      agentId: 'ada',
      id: 'obj-cap',
      title: 'Runaway',
      tasks: [{ id: 'T1', title: 'burn' }],
      budgetUsd: 0.001,
    });

    let previousSpent = 0;
    let costs = '';
    const costsPath = path.join(
      home,
      'workspaces',
      'ws1',
      'agents',
      'ada',
      'objectives',
      'obj-cap',
      'costs.ndjson',
    );
    for (let restart = 0; restart < 5; restart++) {
      await client.startObjective('ws1', 'ada', 'obj-cap');
      await waitSettled(client);
      try {
        costs = await readFile(costsPath, 'utf8');
      } catch {
        costs = '';
      }
      const spent = costs
        .trim()
        .split('\n')
        .filter(Boolean)
        .reduce((total, line) => {
          const event = JSON.parse(line) as { payload?: { usd?: number } };
          return total + (event.payload?.usd ?? 0);
        }, 0);
      // invariant: each HUMAN-driven restart may admit at most ONE in-flight
      // cost event past the trip point — never an unbounded loop
      expect(spent - previousSpent).toBeLessThanOrEqual(0.01);
      previousSpent = spent;
      if (restart < 4) {
        // keep the cap unchanged — every restart must re-stop
        expect((await readFile(path.join(path.dirname(costsPath), 'checkpoints', 'T1.yaml'), 'utf8')).toString()).toContain(
          'pending',
        );
      }
    }
  }, 60_000);
});
