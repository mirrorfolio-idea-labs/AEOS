import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AeosClient } from '@aeos/sdk';

/**
 * P3 exit gate (ROADMAP top of P3) — the unattended demo on the real
 * daemon: objective in → plan generated with task classes → tasks routed to
 * different models by class → verification gates progression (an induced
 * failure re-opens the code task) → the retrospective writes a lesson into
 * memory → the NEXT objective's session brief provably carries it.
 * No human touches anything between "create objective" and the assertions.
 */

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');
const cleanups: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('P3 exit gate — unattended autonomy loop on the real daemon', () => {
  it('plan → route by class → verify gates → retrospective → next brief carries the lesson', { timeout: 120_000 }, async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'aeos-p3-exit-'));
    const home = path.join(scratch, 'home');
    const repo = path.join(scratch, 'repo');
    const promptLog = path.join(scratch, 'prompts.ndjson');
    const counter = path.join(scratch, 'verify-runs');
    execFileSync('mkdir', ['-p', home, repo]);
    git(repo, 'init', '--quiet', '-b', 'main');
    await writeFile(path.join(repo, 'README.md'), '# app\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=u', '-c', 'user.email=u@u', 'commit', '--quiet', '-m', 'init');

    const port = 9400 + (process.pid % 500);
    const child = spawn(process.execPath, [MAIN, 'run'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        AEOS_HOME: home,
        AEOS_PORT: String(port),
        AEOS_PROVIDER: 'fake',
        AEOS_FAKE_PACE_MS: '5',
        AEOS_FAKE_PROMPT_LOG: promptLog,
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

    // unattended posture: the operator pre-authorises plans and commands for this workspace
    await client.createWorkspace({ id: 'ws1', name: 'WS' });
    await writeFile(path.join(home, 'workspaces', 'ws1', 'policy.yaml'), 'tiers:\n  execute_commands: allow\n  run_plan: allow\n');
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
    // the "test suite" fails its first run (and its retry), then passes — an induced failure
    const verify = `n=$(cat ${counter} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${counter}; [ $n -gt 2 ] || { echo "FAIL: widget test"; exit 1; }`;
    await client.bindRepo('ws1', 'dev', { id: 'app', path: repo, verify: [verify] });

    const settle = async (id: string) => {
      let s = await client.objectiveStatus('ws1', 'dev', id);
      for (let i = 0; i < 600 && (s.running || s.tasks.length === 0 || s.tasks.some((t) => t.status === 'pending')); i++) {
        await new Promise((r) => setTimeout(r, 50));
        s = await client.objectiveStatus('ws1', 'dev', id);
      }
      return s;
    };

    // 1. objective in → classed plan generated (planner), verify interleaved after the code task
    await client.createObjective({ workspaceId: 'ws1', agentId: 'dev', id: 'o1', title: 'Widgets', repo: 'app', autoPlan: true, retrospective: 'apply' });
    await client.startObjective('ws1', 'dev', 'o1');
    const o1 = await settle('o1');
    expect(o1.tasks.map((t) => `${t.id}:${t.taskClass}:${t.status}`)).toEqual([
      'T1:architect:completed',
      'T2:implement:completed',
      'V1:verify:completed',
      'T3:review:completed',
    ]);

    // 2. routed by class: frontier model for architect/review, a cheaper one for implement
    const routes = await client.objectiveRoutes('ws1', 'dev', 'o1');
    const modelOf = (taskId: string) => routes.find((r) => r.taskId === taskId)?.decision.model;
    expect(modelOf('T1')).toBeDefined();
    expect(modelOf('T2')).toBeDefined();
    expect(modelOf('T1')).not.toBe(modelOf('T2'));
    expect(modelOf('T3')).toBe(modelOf('T1'));

    // 3. verification gated progression: the failure re-opened T2, which re-ran with the output
    const v1 = o1.checkpoints.find((c) => c.taskId === 'V1') as { attempts: number; verification?: { outcome: string } };
    expect(v1).toMatchObject({ attempts: 2, verification: { outcome: 'pass' } });
    const prompts = (await readFile(promptLog, 'utf8')).trimEnd().split('\n').map((l) => JSON.parse(l) as string);
    const implementRuns = prompts.filter((p) => p.startsWith('Implement Widgets'));
    expect(implementRuns).toHaveLength(2);
    expect(implementRuns[1]).toContain('FAIL: widget test');

    // 4. the retrospective wrote the lesson into memory (unattended: retrospective: apply)
    const lessonFile = path.join(home, 'workspaces', 'ws1', 'agents', 'dev', 'memory', 'lessons', 'verification-o1.md');
    const lesson = await readFile(lessonFile, 'utf8');
    expect(lesson).toContain('Lesson: run');

    // 5. the next objective's session brief carries the lesson byte-for-byte
    await client.createObjective({ workspaceId: 'ws1', agentId: 'dev', id: 'o2', title: 'Gadgets', tasks: [{ id: 'T1', title: 'Build gadgets' }], retrospective: 'off' });
    await client.startObjective('ws1', 'dev', 'o2');
    const o2 = await settle('o2');
    expect(o2.tasks.map((t) => t.status)).toEqual(['completed']);
    const after = (await readFile(promptLog, 'utf8')).trimEnd().split('\n').map((l) => JSON.parse(l) as string);
    const brief = after.find((p) => p.startsWith('Build gadgets'));
    expect(brief).toBeDefined();
    expect(brief).toContain(lesson.trimEnd());
  });
});
