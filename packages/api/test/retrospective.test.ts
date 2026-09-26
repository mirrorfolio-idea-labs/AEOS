import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CredentialProfileSchema } from '@aeos/contracts';
import { createEventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents, type HarnessAdapter, type SpawnOptions } from '@aeos/provider-core';
import { createApiServer } from '../src/index.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let home: string;
let repo: string;
let app: FastifyInstance;
const prompts: string[] = [];
let brokenRuns = 0;

function worker(): HarnessAdapter {
  const inner = new FakeAdapter({ providerSessionId: 'ses', events: buildFixtureEvents({ profileId: 'cp' }) });
  return {
    id: 'fake',
    capabilities: () => inner.capabilities(),
    createProfile: (a) => inner.createProfile(a),
    translate: (r) => inner.translate(r),
    spawn(opts: SpawnOptions) {
      prompts.push(opts.objective);
      if (opts.workdir !== undefined && /^(Build|Address)/.test(opts.objective)) {
        writeFileSync(path.join(opts.workdir, 'status.txt'), brokenRuns > 0 ? 'broken: missing import\n' : 'ok\n');
        brokenRuns -= 1;
      }
      return inner.spawn(opts);
    },
  };
}

const objDir = (id: string) => path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'objectives', id);
const q = 'workspaceId=ws&agentId=dev';

async function runToEnd(id: string): Promise<void> {
  await app.inject({ method: 'POST', url: `/v1/objectives/${id}/start?${q}` });
  await delay(30);
  for (let i = 0; i < 400; i++) {
    if (!(await app.inject({ url: `/v1/objectives/${id}?${q}` })).json().data.running) return;
    await delay(20);
  }
  throw new Error(`${id} did not settle`);
}

async function createObjective(id: string, plan: string, extra: Record<string, unknown> = {}): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/v1/objectives',
    payload: { workspaceId: 'ws', agentId: 'dev', id, title: `Objective ${id}`, repo: 'app', tasks: [{ id: 'T1', title: 'x' }], ...extra },
  });
  writeFileSync(path.join(objDir(id), 'plan.md'), plan);
}

beforeEach(async () => {
  prompts.length = 0;
  brokenRuns = 0;
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-retro-'));
  repo = await mkdtemp(path.join(os.tmpdir(), 'aeos-retro-repo-'));
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
  await app.inject({
    method: 'POST',
    url: `/v1/agents/dev/repos?workspaceId=ws`,
    payload: { id: 'app', path: repo, verify: ['grep -qx ok status.txt'] },
  });
});
afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

const EXPECTED_LESSON = [
  '# Verification lessons — Objective o1',
  '',
  '- `grep -qx ok status.txt` failed 1× on "Verify T1".',
  '',
  'Lesson: run `grep -qx ok status.txt` yourself before finishing any code task in this repository.',
  '',
].join('\n');

const EXPECTED_PREFERENCE = [
  '# Reviewer preferences — Objective o1',
  '',
  'The operator corrected this work in review. Apply the same standard next time:',
  '',
  '- status.txt:1: Use lowercase status words only',
  '',
].join('\n');

describe('retrospective / self-learning loop (P3.M4)', () => {
  async function objectiveOneWithFailureAndReview(): Promise<void> {
    brokenRuns = 1;
    await createObjective('o1', '# o1\n\n- [ ] **T1** Build the feature\n- [ ] **V1** [verify] Verify T1\n');
    await runToEnd('o1');
    await app.inject({
      method: 'POST',
      url: `/v1/objectives/o1/review?${q}`,
      payload: { comments: [{ file: 'status.txt', line: 1, body: 'Use lowercase status words only' }] },
    });
    await runToEnd('o1');
  }

  it('T1 accept: the fixture objective produces the expected lesson + preference proposals', async () => {
    await objectiveOneWithFailureAndReview();
    const proposals = (await app.inject({ url: `/v1/memory/proposals?${q}` })).json().data as Array<{ id: string; path: string; content: string }>;
    expect(proposals.map((p) => `${p.id} → ${p.path}`)).toEqual([
      'retro-o1-review-preferences → preferences/review-o1.md',
      'retro-o1-verification → lessons/verification-o1.md',
    ]);
    expect(proposals.find((p) => p.path === 'lessons/verification-o1.md')?.content).toBe(EXPECTED_LESSON);
    expect(proposals.find((p) => p.path === 'preferences/review-o1.md')?.content).toBe(EXPECTED_PREFERENCE);
    // proposals never write memory directly (spec §8 rule 2)
    expect(() => readFileSync(path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'memory', 'lessons', 'verification-o1.md'))).toThrow();
  });

  it('T2 accept + exit gate: objective 2 provably benefits — its session brief carries objective 1’s accepted lesson and preference byte-for-byte', async () => {
    await objectiveOneWithFailureAndReview();
    const applied = (await app.inject({ method: 'POST', url: `/v1/memory/proposals/apply?${q}`, payload: {} })).json().data;
    expect(applied.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied']);

    prompts.length = 0;
    await createObjective('o2', '# o2\n\n- [ ] **T1** Build the next feature\n- [ ] **V1** [verify] Verify T1\n', { retrospective: 'off' });
    await runToEnd('o2');
    const brief = prompts.find((p) => p.startsWith('Build the next feature'));
    expect(brief).toBeDefined();
    expect(brief).toContain(EXPECTED_PREFERENCE.trimEnd());
    expect(brief).toContain(EXPECTED_LESSON.trimEnd());
  });

  it('rejecting a proposal drops it without touching memory; re-running the retrospective does not duplicate', async () => {
    await objectiveOneWithFailureAndReview();
    const rejected = await app.inject({ method: 'POST', url: `/v1/memory/proposals/retro-o1-verification/reject?${q}` });
    expect(rejected.statusCode).toBe(200);
    await runToEnd('o1'); // re-run → retrospective runs again
    const ids = ((await app.inject({ url: `/v1/memory/proposals?${q}` })).json().data as Array<{ id: string }>).map((p) => p.id);
    expect(ids.filter((id) => id === 'retro-o1-review-preferences')).toHaveLength(1);
  });

  it('retrospective: apply accepts at once (unattended runs); a clean objective proposes nothing', async () => {
    brokenRuns = 1;
    await createObjective('o3', '# o3\n\n- [ ] **T1** Build it\n- [ ] **V1** [verify] Verify T1\n', { retrospective: 'apply' });
    await runToEnd('o3');
    expect(readFileSync(path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'memory', 'lessons', 'verification-o3.md'), 'utf8')).toContain(
      'Lesson: run `grep -qx ok status.txt`',
    );
    await createObjective('o4', '# o4\n\n- [ ] **T1** Build it\n- [ ] **V1** [verify] Verify T1\n');
    await runToEnd('o4');
    const ids = ((await app.inject({ url: `/v1/memory/proposals?${q}` })).json().data as Array<{ id: string }>).map((p) => p.id);
    expect(ids.some((id) => id.startsWith('retro-o4'))).toBe(false);
  });
});
