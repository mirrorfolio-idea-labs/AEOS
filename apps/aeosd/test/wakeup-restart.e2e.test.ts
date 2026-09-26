import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { AeosClient } from '@aeos/sdk';

/**
 * P3.M5.T1 accept: a scheduled job survives a daemon kill + restart. The
 * job's slot comes due while the daemon is DOWN (SIGKILL — no graceful
 * shutdown); the restarted daemon fires it once on its first tick and the
 * objective runs to completion.
 */

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');
const cleanups: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function boot(home: string, port: number): Promise<{ child: ChildProcess; stderr: () => string }> {
  const child = spawn(process.execPath, [MAIN, 'run'], {
    env: {
      PATH: process.env['PATH'] ?? '',
      AEOS_HOME: home,
      AEOS_PORT: String(port),
      AEOS_PROVIDER: 'fake',
      AEOS_FAKE_PACE_MS: '5',
      AEOS_WAKEUP_TICK_MS: '100',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));
  cleanups.push(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  for (let i = 0; i < 300 && !stderr.includes('aeosd ready'); i++) await new Promise((r) => setTimeout(r, 50));
  expect(stderr).toContain('aeosd ready');
  return { child, stderr: () => stderr };
}

describe('durable wakeups survive a daemon restart (P3.M5.T1)', () => {
  it('a cron job missed while the daemon was killed fires once on the next boot and completes its objective', { timeout: 90_000 }, async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-wakeup-'));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const port = 8900 + (process.pid % 500);
    const client = new AeosClient({ baseUrl: `http://127.0.0.1:${port}` });

    const first = await boot(home, port);
    await client.createWorkspace({ id: 'ws1', name: 'WS' });
    await client.createAgent({
      id: 'dev',
      workspaceId: 'ws1',
      name: 'Dev',
      harness: {
        provider: 'claude-code',
        featureToggles: { plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false },
      },
      credentialProfileId: 'cp',
    });
    await client.createObjective({ workspaceId: 'ws1', agentId: 'dev', id: 'nightly', title: 'Nightly', tasks: [{ id: 'T1', title: 'nightly chores' }] });
    // daily at 03:00 UTC — never due during this test on its own
    await client.saveJob({ id: 'nightly', kind: 'cron', cron: '0 3 * * *', action: { type: 'start-objective', workspaceId: 'ws1', agentId: 'dev', objectiveId: 'nightly' } });
    await expect(client.saveJob({ id: 'bad', kind: 'cron', cron: 'not a cron', action: { type: 'curator' } })).rejects.toThrow();
    expect((await client.listJobs()).map((j) => j.id)).toEqual(['nightly']);

    first.child.kill('SIGKILL');
    await new Promise((r) => first.child.once('exit', r));

    // while the daemon is down, two days pass: two 03:00 slots are missed
    const jobFile = path.join(home, 'jobs', 'nightly.yaml');
    const job = parseYaml(await readFile(jobFile, 'utf8')) as Record<string, unknown>;
    await writeFile(jobFile, stringifyYaml({ ...job, createdAt: new Date(Date.now() - 2 * 24 * 3_600_000).toISOString() }));

    const second = await boot(home, port);
    let status = await client.objectiveStatus('ws1', 'dev', 'nightly');
    for (let i = 0; i < 400 && !(status.tasks.every((t) => t.status === 'completed') && !status.running); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = await client.objectiveStatus('ws1', 'dev', 'nightly');
    }
    expect(status.tasks.map((t) => `${t.id}:${t.status}`)).toEqual(['T1:completed']);

    // fired exactly once for both missed slots, and the run is recorded
    await new Promise((r) => setTimeout(r, 500));
    expect(second.stderr().match(/wakeup: fired nightly/g)).toHaveLength(1);
    const [after] = await client.listJobs();
    expect(after?.lastRunAt).toBeDefined();
    expect(after?.lastError).toBeUndefined();
  });
});
