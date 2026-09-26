import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AeosClient } from '@aeos/sdk';

/**
 * P4.M2.T2 accept on the real daemon: a third-party provider plugin
 * installed with `aeos plugin install` runs objective tasks; when it
 * crashes mid-session only that session fails — the daemon keeps serving,
 * and the next task on the same plugin succeeds (restart on demand).
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, '..', 'dist', 'main.js');
const CLI = path.join(HERE, '..', '..', 'cli', 'dist', 'main.js');
const cleanups: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

describe('plugin crash isolation on the real daemon (P4.M2.T2)', () => {
  it('a crashing plugin fails its session, never the daemon', { timeout: 90_000 }, async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'aeos-plugin-crash-'));
    const home = path.join(scratch, 'home');
    const plugin = path.join(scratch, 'aeos-plugin-flaky');
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(
      path.join(plugin, 'package.json'),
      JSON.stringify({ name: 'aeos-plugin-flaky', version: '0.1.0', type: 'module', aeos: { contract: '^1', entry: './index.js', contributes: [{ kind: 'provider', id: 'flaky' }] } }),
    );
    fs.writeFileSync(
      path.join(plugin, 'index.js'),
      `import fs from 'node:fs';
export default { providers: { flaky: () => ({
  capabilities: () => ({ resume: false, structuredOutput: false, mcp: false, sandbox: false, costReporting: false }),
  createProfile: (a) => ({ rootDir: '/tmp/flaky/' + a.id, env: {}, argv: [] }),
  spawn: (opts) => ({ providerSessionId: 'flaky-' + opts.sessionId, kill() {}, events: (async function* () {
    yield { type: 'session.created', payload: {} };
    const marker = /MARKER=(\\S+)/.exec(opts.objective)?.[1];
    if (marker && !fs.existsSync(marker)) { fs.writeFileSync(marker, ''); process.exit(7); }
    yield { type: 'item.message', payload: { role: 'assistant', text: 'done' } };
    yield { type: 'session.completed', payload: {} };
  })() }),
}) } };
`,
    );
    execFileSync(process.execPath, [CLI, 'plugin', 'install', plugin], { env: { ...process.env, AEOS_HOME: home }, stdio: 'ignore' });

    const port = 9700 + (process.pid % 150);
    const child = spawn(process.execPath, [MAIN, 'run'], {
      env: { PATH: process.env['PATH'] ?? '', AEOS_HOME: home, AEOS_PORT: String(port), AEOS_PRICING_OFFLINE: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));
    cleanups.push(async () => {
      if (child.exitCode === null) child.kill('SIGKILL');
      await rm(scratch, { recursive: true, force: true });
    });
    for (let i = 0; i < 300 && !stderr.includes('aeosd ready'); i++) await new Promise((r) => setTimeout(r, 50));
    expect(stderr).toContain('aeosd ready');
    expect(stderr).toContain('plugins: aeos-plugin-flaky@0.1.0 running');
    const client = new AeosClient({ baseUrl: `http://127.0.0.1:${port}` });

    await client.createWorkspace({ id: 'ws1', name: 'WS' });
    await client.createAgent({
      id: 'dev',
      workspaceId: 'ws1',
      name: 'Dev',
      harness: { provider: 'plugin:flaky', featureToggles: { plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false } },
      credentialProfileId: 'cp',
    });
    const run = async (id: string, title: string) => {
      await client.createObjective({ workspaceId: 'ws1', agentId: 'dev', id, title, tasks: [{ id: 'T1', title }] });
      await client.startObjective('ws1', 'dev', id);
      let s = await client.objectiveStatus('ws1', 'dev', id);
      for (let i = 0; i < 400 && (s.running || s.checkpoints.length === 0); i++) {
        await new Promise((r) => setTimeout(r, 50));
        s = await client.objectiveStatus('ws1', 'dev', id);
      }
      return s;
    };

    // the plugin dies (process.exit) on its first session — once
    const marker = path.join(scratch, 'crashed-once');
    const recovered = await run('o-crash', `crash once MARKER=${marker}`);
    expect(stderr).toMatch(/aeos-plugin-flaky exited \(code 7\)/);
    expect(child.exitCode).toBeNull();
    // only that session failed: the scheduler's retry ran on a restarted plugin process
    expect(recovered.tasks.map((t) => t.status)).toEqual(['completed']);
    expect(recovered.checkpoints[0]).toMatchObject({ status: 'completed', attempts: 2 });

    // and the daemon keeps serving everything else
    expect(await client.health()).toBeDefined();
    const fine = await run('o-fine', 'do the work');
    expect(fine.tasks.map((t) => t.status)).toEqual(['completed']);
  });
});
