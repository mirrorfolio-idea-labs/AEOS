import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AeosClient } from '@aeos/sdk';
import { dockerAvailable, homeLabelFor } from '@aeos/provider-core';

/**
 * P4.M1 exit gate — container golden path + escape canary, on the real
 * daemon with the real Claude adapter (a BYO stand-in binary):
 *
 * - T1: an objective's `implement` task runs fully inside a container
 *   (policy `sandbox.tier: container`) and its work lands on the agent
 *   branch like any other task.
 * - T2: the same policy switches `docs` tasks back to tier `none`; inside
 *   the container a host file outside the worktree is neither readable nor
 *   writable, while the `none`-tier control run CAN read it (so the canary
 *   proves isolation, not a typo'd path).
 *
 * Needs a docker daemon; skipped (loudly) without one. CI runners have it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, '..', 'dist', 'main.js');
const FAKE_CLAUDE = path.join(HERE, 'fixtures', 'fake-claude.mjs');
// CI's sandbox-image job points this at the freshly built aeos-runner image
const IMAGE = process.env['AEOS_SANDBOX_E2E_IMAGE'] ?? 'node:22-slim';
const HAVE_DOCKER = dockerAvailable();
if (!HAVE_DOCKER) console.warn('sandbox-container e2e SKIPPED: no docker daemon reachable');

const cleanups: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe.skipIf(!HAVE_DOCKER)('container sandbox tier (P4.M1)', () => {
  it('golden path inside a container; escape canary untouchable; policy switches tiers per class', { timeout: 240_000 }, async () => {
    if (process.env['AEOS_SANDBOX_E2E_IMAGE'] === undefined) execFileSync('docker', ['pull', '--quiet', IMAGE], { stdio: 'ignore', timeout: 180_000 });
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'aeos-sandbox-'));
    const home = path.join(scratch, 'home');
    const repo = path.join(scratch, 'repo');
    const canary = path.join(scratch, 'host-canary.txt');
    execFileSync('mkdir', ['-p', home, repo]);
    await writeFile(canary, 'host secret — must stay untouched\n');
    git(repo, 'init', '--quiet', '-b', 'main');
    await writeFile(path.join(repo, 'README.md'), '# app\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=u', '-c', 'user.email=u@u', 'commit', '--quiet', '-m', 'init');

    const port = 9900 + (process.pid % 90);
    const child = spawn(process.execPath, [MAIN, 'run'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        AEOS_HOME: home,
        AEOS_PORT: String(port),
        ANTHROPIC_API_KEY: 'sk-test-not-a-real-key',
        AEOS_PRICING_OFFLINE: '1',
      },
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
    const client = new AeosClient({ baseUrl: `http://127.0.0.1:${port}` });

    await client.createWorkspace({ id: 'ws1', name: 'WS' });
    // T2: one policy fixture, two tiers — code tasks contained, docs tasks not
    await writeFile(
      path.join(home, 'workspaces', 'ws1', 'policy.yaml'),
      ['tiers:', '  execute_commands: allow', 'sandbox:', '  tier: container', `  image: ${IMAGE}`, '  network: none', '  classes:', '    docs: none', ''].join('\n'),
    );
    await client.createAgent({
      id: 'dev',
      workspaceId: 'ws1',
      name: 'Dev',
      harness: {
        provider: 'claude-code',
        binaryPath: FAKE_CLAUDE,
        featureToggles: { plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false },
      },
      credentialProfileId: 'cp',
    });
    await client.bindRepo('ws1', 'dev', { id: 'app', path: repo });
    await client.createObjective({ workspaceId: 'ws1', agentId: 'dev', id: 'o1', title: 'Contained', repo: 'app', tasks: [{ id: 'T1', title: 'x' }] });
    await writeFile(
      path.join(home, 'workspaces', 'ws1', 'agents', 'dev', 'objectives', 'o1', 'plan.md'),
      `# o1\n\n- [ ] **T1** Implement it PROOF=contained TRY_WRITE CANARY=${canary}\n- [ ] **T2** [docs] Document it PROOF=control CANARY=${canary}\n`,
    );
    await client.startObjective('ws1', 'dev', 'o1');
    let s = await client.objectiveStatus('ws1', 'dev', 'o1');
    for (let i = 0; i < 1200 && (s.running || s.tasks.some((t) => t.status === 'pending')); i++) {
      await new Promise((r) => setTimeout(r, 100));
      s = await client.objectiveStatus('ws1', 'dev', 'o1');
    }
    expect(s.tasks.map((t) => `${t.id}:${t.status}`), stderr).toEqual(['T1:completed', 'T2:completed']);

    // T1: the implement task ran inside the container, in the worktree, and its work was committed
    const branch = 'aeos/dev/o1';
    const contained = JSON.parse(git(repo, 'show', `${branch}:contained.json`)) as Record<string, unknown>;
    expect(contained['inContainer']).toBe(true);
    expect(contained['configDirVisible']).toBe(true);
    expect(contained['uid']).toBe(process.getuid?.());
    // escape canary: a host file outside the worktree does not exist in there
    expect(contained['canaryRead']).toMatchObject({ ok: false, code: 'ENOENT' });
    // a write to that path at most lands in the container's throwaway layer —
    // the host file is byte-identical afterwards
    expect(contained['canaryWrite']).toBeDefined();
    expect(await readFile(canary, 'utf8')).toBe('host secret — must stay untouched\n');

    // T2 control: the docs task ran uncontained and COULD read the same path
    const control = JSON.parse(git(repo, 'show', `${branch}:control.json`)) as Record<string, unknown>;
    expect(control['inContainer']).toBe(false);
    expect(control['canaryRead']).toMatchObject({ ok: true });

    // the tier choice is audited on route.decided, and no container outlives its session
    const events = execFileSync('sh', ['-c', `cat ${path.join(home, 'audit')}/*.ndjson`], { encoding: 'utf8' });
    expect(events).toMatch(/"route.decided"[^\n]*"taskId":"T1"|"taskId":"T1"[^\n]*"route.decided"/);
    expect(events).toContain('"sandbox":"container"');
    expect(events).toContain('"sandbox":"none"');
    const leftovers = execFileSync('docker', ['ps', '-aq', '--filter', `label=aeos.home=${homeLabelFor(home)}`], { encoding: 'utf8' }).trim();
    expect(leftovers).toBe('');
  });
});
