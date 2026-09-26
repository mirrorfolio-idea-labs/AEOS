import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CredentialProfileSchema } from '@aeos/contracts';
import { createEventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents, type HarnessAdapter, type SpawnOptions } from '@aeos/provider-core';
import { PLANNING_MARKER, runVerification } from '@aeos/scheduler';
import { createApiServer } from '../src/index.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('verification runner (P3.M3.T1)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'aeos-verify-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accept: pass / fail / flaky are distinguished', async () => {
    expect(await runVerification({ cwd: dir, commands: ['true', 'echo ok'] })).toMatchObject({ outcome: 'pass' });

    const failed = await runVerification({ cwd: dir, commands: ['true', 'echo boom >&2; exit 3', 'echo never'] });
    expect(failed.outcome).toBe('fail');
    expect(failed.commands).toHaveLength(2); // stops at the first failure
    expect(failed.commands[1]).toMatchObject({ exitCode: 3, attempts: 2 });
    expect(failed.commands[1]?.outputTail).toContain('boom');

    // fails the first time, passes on retry → flaky
    const flaky = await runVerification({ cwd: dir, commands: ['if [ -f seen ]; then exit 0; else touch seen; exit 1; fi'] });
    expect(flaky).toMatchObject({ outcome: 'flaky', commands: [{ exitCode: 0, attempts: 2 }] });

    expect(await runVerification({ cwd: dir, commands: [] })).toMatchObject({ outcome: 'fail', fatal: expect.stringContaining('no verification commands') });
  });

  it('times out a hung command and kills its process group', async () => {
    const started = Date.now();
    const result = await runVerification({ cwd: dir, commands: ['sleep 30'], timeoutMs: 200, retries: 0 });
    expect(result.outcome).toBe('fail');
    expect(result.commands[0]?.outputTail).toContain('timed out');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('verify tasks gate progression (P3.M3.T2 + exit gate)', () => {
  let home: string;
  let repo: string;
  let app: FastifyInstance;
  const prompts: string[] = [];
  /** How many implement sessions write a *broken* build before a correct one. */
  let brokenRuns = 0;

  function worker(): HarnessAdapter {
    const inner = new FakeAdapter({
      providerSessionId: 'ses',
      events: buildFixtureEvents({ profileId: 'cp' }),
      respond: (prompt) =>
        prompt.startsWith(PLANNING_MARKER) ? '- [ ] **T1** [architect] Design\n- [ ] **T2** Build it\n- [ ] **T3** [docs] Docs' : undefined,
    });
    return {
      id: 'fake',
      capabilities: () => inner.capabilities(),
      createProfile: (a) => inner.createProfile(a),
      translate: (r) => inner.translate(r),
      spawn(opts: SpawnOptions) {
        prompts.push(opts.objective);
        if (opts.workdir !== undefined && opts.objective.startsWith('Build')) {
          writeFileSync(path.join(opts.workdir, 'status.txt'), brokenRuns > 0 ? 'broken\n' : 'ok\n');
          brokenRuns -= 1;
        }
        return inner.spawn(opts);
      },
    };
  }

  beforeEach(async () => {
    prompts.length = 0;
    brokenRuns = 0;
    home = await mkdtemp(path.join(os.tmpdir(), 'aeos-vhome-'));
    repo = await mkdtemp(path.join(os.tmpdir(), 'aeos-vrepo-'));
    git(repo, 'init', '--quiet', '-b', 'main');
    writeFileSync(path.join(repo, 'status.txt'), 'ok\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=u', '-c', 'user.email=u@u', 'commit', '--quiet', '-m', 'init');
    app = await createApiServer({
      home,
      adapterFor: () => worker(),
      credentialFor: () => CredentialProfileSchema.parse({ id: 'cp', kind: 'api-key', secretRef: 'x' }),
      bus: createEventBus(),
      notify: false,
    });
    await app.inject({ method: 'POST', url: '/v1/workspaces', payload: { id: 'ws', name: 'W' } });
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      payload: { id: 'dev', workspaceId: 'ws', name: 'Dev', harness: { provider: 'claude-code', featureToggles: {} }, credentialProfileId: 'cp' },
    });
    // the "test suite": the build is green iff status.txt says ok
    await app.inject({
      method: 'POST',
      url: '/v1/agents/dev/repos?workspaceId=ws',
      payload: { id: 'app', path: repo, verify: ['grep -qx ok status.txt'] },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: {
        workspaceId: 'ws',
        agentId: 'dev',
        id: 'obj',
        title: 'Ship',
        repo: 'app',
        tasks: [{ id: 'T1', title: 'placeholder' }],
      },
    });
    writeFileSync(
      path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'objectives', 'obj', 'plan.md'),
      '# Ship\n\n- [ ] **T1** Build the feature\n- [ ] **V1** [verify] Verify T1\n- [ ] **T2** [docs] Document it\n',
    );
  });
  afterEach(async () => {
    await app.close();
    await rm(home, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  const status = async () => (await app.inject({ url: '/v1/objectives/obj?workspaceId=ws&agentId=dev' })).json().data;
  async function settle(): Promise<{ tasks: Array<{ id: string; status: string }>; checkpoints: Array<{ taskId: string; status: string; attempts: number; verification?: { outcome: string } }> }> {
    await app.inject({ method: 'POST', url: '/v1/objectives/obj/start?workspaceId=ws&agentId=dev' });
    await delay(50);
    for (let i = 0; i < 400; i++) {
      const s = await status();
      if (!s.running) return s;
      await delay(20);
    }
    throw new Error('objective did not settle');
  }

  it('a failed verify re-opens the code task with the failure; the fix then passes and the plan proceeds', async () => {
    brokenRuns = 1;
    const s = await settle();
    expect(s.tasks.map((t) => `${t.id}:${t.status}`)).toEqual(['T1:completed', 'V1:completed', 'T2:completed']);
    const v1 = s.checkpoints.find((c) => c.taskId === 'V1');
    expect(v1).toMatchObject({ attempts: 2, verification: { outcome: 'pass' } });
    // the re-run of T1 was told exactly what broke
    const buildPrompts = prompts.filter((p) => p.startsWith('Build'));
    expect(buildPrompts).toHaveLength(2);
    expect(buildPrompts[1]).toContain('## Verification V1 failed');
    expect(buildPrompts[1]).toContain('grep -qx ok status.txt');
  });

  it('exit gate: an induced persistent failure blocks the plan after 3 strikes (spec §12), never reaching later tasks', async () => {
    brokenRuns = 99;
    const s = await settle();
    expect(s.tasks.map((t) => `${t.id}:${t.status}`)).toEqual(['T1:completed', 'V1:blocked', 'T2:pending']);
    const v1 = s.checkpoints.find((c) => c.taskId === 'V1');
    expect(v1).toMatchObject({ status: 'blocked', attempts: 3, verification: { outcome: 'fail' } });
    expect(prompts.filter((p) => p.startsWith('Build'))).toHaveLength(3);
    expect(prompts.some((p) => p.startsWith('Document'))).toBe(false);
  });

  it('accept (T2): generated plans interleave a verify task after each code task when verification is configured', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: { workspaceId: 'ws', agentId: 'dev', id: 'auto', title: 'Auto', repo: 'app', autoPlan: true },
    });
    await app.inject({ method: 'POST', url: '/v1/objectives/auto/start?workspaceId=ws&agentId=dev' });
    let s: { running: boolean; tasks: Array<{ id: string; taskClass: string; status: string }> } = { running: true, tasks: [] };
    for (let i = 0; i < 300 && (s.running || s.tasks.length === 0); i++) {
      await delay(20);
      s = (await app.inject({ url: '/v1/objectives/auto?workspaceId=ws&agentId=dev' })).json().data;
    }
    expect(s.tasks.map((t) => `${t.id}:${t.taskClass}:${t.status}`)).toEqual([
      'T1:architect:completed',
      'T2:implement:completed',
      'V1:verify:completed',
      'T3:docs:completed',
    ]);
  });

  it('a verify task without a worktree blocks at once with a clear reason', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: { workspaceId: 'ws', agentId: 'dev', id: 'o2', title: 'x', tasks: [{ id: 'V1', title: 'check' }] },
    });
    writeFileSync(
      path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'objectives', 'o2', 'plan.md'),
      '# x\n\n- [ ] **V1** [verify] Verify nothing\n',
    );
    await app.inject({ method: 'POST', url: '/v1/objectives/o2/start?workspaceId=ws&agentId=dev' });
    let s: { running: boolean; checkpoints: Array<{ status: string; summary?: string }> } = { running: true, checkpoints: [] };
    for (let i = 0; i < 200 && (s.running || s.checkpoints.length === 0); i++) {
      await delay(20);
      s = (await app.inject({ url: '/v1/objectives/o2?workspaceId=ws&agentId=dev' })).json().data;
    }
    expect(s.checkpoints[0]).toMatchObject({ status: 'blocked' });
    expect(existsSync(path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'objectives', 'o2', 'checkpoints', 'V1.yaml'))).toBe(true);
    expect(readFileSync(path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'objectives', 'o2', 'checkpoints', 'V1.yaml'), 'utf8')).toContain(
      'needs a repo worktree',
    );
  });
});
