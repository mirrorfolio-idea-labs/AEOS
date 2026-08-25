import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AeosClient } from '@aeos/sdk';

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');

interface DaemonHandle {
  child: ChildProcess;
  client: AeosClient;
  baseUrl: string;
  stderr: { text: string };
}

const cleanups: Array<() => Promise<void> | void> = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function startDaemon(home: string, port: number, paceMs = 60): Promise<DaemonHandle> {
  const child = spawn(process.execPath, [MAIN, 'run'], {
    env: {
      PATH: process.env['PATH'] ?? '',
      AEOS_HOME: home,
      AEOS_PORT: String(port),
      AEOS_PROVIDER: 'fake',
      AEOS_FAKE_PACE_MS: String(paceMs),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  cleanups.push(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  const stderr = { text: '' };
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr.text += chunk.toString();
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`daemon boot timeout:\n${stderr.text}`)),
      30_000,
    );
    const check = setInterval(() => {
      if (stderr.text.includes('aeosd ready')) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 20);
    child.once('exit', (code) => {
      clearTimeout(timer);
      clearInterval(check);
      reject(new Error(`daemon exited during boot (${code}):\n${stderr.text}`));
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  return { child, client: new AeosClient({ baseUrl }), baseUrl, stderr };
}

async function waitForTask(
  client: AeosClient,
  objectiveId: string,
  predicate: (statuses: string[]) => boolean,
  timeoutMs = 45_000,
  daemon?: DaemonHandle,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let lastStatuses: string[] = [];
  for (;;) {
    try {
      const status = await client.objectiveStatus('ws1', 'dev', objectiveId);
      lastStatuses = status.tasks.map((t) => t.status);
      if (predicate(lastStatuses)) return lastStatuses;
    } catch (error) {
      lastError = error; // daemon may be mid-restart
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${objectiveId} (last statuses: ${JSON.stringify(lastStatuses)}, last error: ${String(lastError)})${
          daemon ? `\n--- daemon stderr ---\n${daemon.stderr.text}` : ''
        }`,
      );
    }
    await delay(50);
  }
}

/**
 * The golden path proves crash/resume MECHANICS (P1), not policy posture
 * (P2.M1). Its fixture home opts into a permissive execute tier so the run
 * never parks on an approval — posture coverage lives in approval-flow.e2e.
 */
async function setUpAgent(client: AeosClient, home: string): Promise<void> {
  await client.createWorkspace({ id: 'ws1', name: 'Workspace' });
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(path.join(home, 'workspaces', 'ws1'), { recursive: true });
  await writeFile(
    path.join(home, 'workspaces', 'ws1', 'policy.yaml'),
    'tiers:\n  execute_commands: allow\n',
  );
  await client.createAgent({
    id: 'dev',
    workspaceId: 'ws1',
    name: 'Dev',
    harness: { provider: 'claude-code', featureToggles: {
      plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false,
    } },
    credentialProfileId: 'cp-default',
  });
}

describe('P1 exit gate — golden path with kill -9 (T1)', () => {
  it('create → work → SIGKILL daemon → restart → resume → complete, 10× consecutively', async () => {
    for (let cycle = 0; cycle < 10; cycle++) {
      const home = await mkdtemp(path.join(os.tmpdir(), `aeos-e2e-${cycle}-`));
      const port = 7801 + cycle;
      const first = await startDaemon(home, port);
      await setUpAgent(first.client, home);
      await first.client.createObjective({
        workspaceId: 'ws1',
        agentId: 'dev',
        id: 'obj',
        title: 'Golden path',
        tasks: [
          { id: 'T1', title: 'first task' },
          { id: 'T2', title: 'second task' },
          { id: 'T3', title: 'third task' },
        ],
      });
      await first.client.startObjective('ws1', 'dev', 'obj');
      // let the agent finish T1 and get into T2, then murder the daemon
      await waitForTask(first.client, 'obj', (s) => s[0] === 'completed', 45_000, first);
      first.child.kill('SIGKILL');
      await new Promise((resolve) => first.child.once('exit', resolve));

      // files are truth: the plan on disk is mid-flight, not complete
      const midPlan = await readFile(
        path.join(home, 'workspaces', 'ws1', 'agents', 'dev', 'objectives', 'obj', 'plan.md'),
        'utf8',
      );
      expect(midPlan).not.toContain('- [x] **T3**');

      // restart: resume-on-boot must pick the objective up with no API call
      const second = await startDaemon(home, port);
      const statuses = await waitForTask(
        second.client,
        'obj',
        (s) => s.every((status) => status === 'completed'),
        45_000,
        second,
      );
      expect(statuses).toEqual(['completed', 'completed', 'completed']);

      second.child.kill('SIGTERM');
      await new Promise((resolve) => second.child.once('exit', resolve));
      await rm(home, { recursive: true, force: true });
    }
  }, 480_000);
});

describe('kill switch (T3)', () => {
  it('STOP halts new spawns within one task boundary; lifting it resumes', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-stop-'));
    const port = 7897;
    // Generous pacing: T1's replay must still be in flight when /v1/stop
    // lands, so the assertion proves "in-flight finishes, next never
    // spawns" rather than racing a fast fake provider to the finish line.
    // Wide margin because full-workspace CI runs many suites concurrently.
    const daemon = await startDaemon(home, port, 600);
    await setUpAgent(daemon.client, home);
    await daemon.client.createObjective({
      workspaceId: 'ws1',
      agentId: 'dev',
      id: 'obj-stop',
      title: 'Stoppable',
      tasks: [
        { id: 'T1', title: 'first task' },
        { id: 'T2', title: 'second task' },
      ],
    });
    await daemon.client.startObjective('ws1', 'dev', 'obj-stop');
    // Wait for OBSERVABLE evidence that T1 actually started before engaging
    // STOP — starting the objective and posting /v1/stop are both async, so
    // racing them blind can catch T1 before it ever spawns (which is a
    // different, less interesting case than "in-flight survives, next
    // doesn't spawn").
    await waitForTask(daemon.client, 'obj-stop', (s) => s[0] === 'in_progress', 45_000, daemon);
    const engage = await fetch(`${daemon.baseUrl}/v1/stop`, { method: 'POST' });
    expect(engage.status).toBe(200);
    // T1's in-flight session finishes uninterrupted...
    await waitForTask(daemon.client, 'obj-stop', (s) => s[0] === 'completed', 45_000, daemon);
    // ...but T2 must never spawn while STOP holds, even after settling
    await delay(1_000);
    const halted = await waitForTask(daemon.client, 'obj-stop', () => true, 45_000, daemon);
    expect(halted[1]).not.toBe('completed');

    // starting anything new is refused outright
    const refused = await fetch(
      `${daemon.baseUrl}/v1/objectives/obj-stop/start?workspaceId=ws1&agentId=dev`,
      { method: 'POST' },
    );
    expect(refused.status).toBe(409);

    // lift the switch → same start call resumes to completion
    await fetch(`${daemon.baseUrl}/v1/stop`, { method: 'DELETE' });
    await daemon.client.startObjective('ws1', 'dev', 'obj-stop');
    const statuses = await waitForTask(
      daemon.client,
      'obj-stop',
      (s) => s.every((status) => status === 'completed'),
      45_000,
      daemon,
    );
    expect(statuses).toEqual(['completed', 'completed']);

    daemon.child.kill('SIGTERM');
    await new Promise((resolve) => daemon.child.once('exit', resolve));
    await rm(home, { recursive: true, force: true });
  }, 90_000);
});
