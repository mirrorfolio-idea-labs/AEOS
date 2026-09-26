import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CredentialProfileSchema, type AgentConfig } from '@aeos/contracts';
import { createEventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents, type HarnessAdapter, type SpawnOptions } from '@aeos/provider-core';
import { createApiServer } from '../src/index.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let home: string;
let repo: string;
let app: FastifyInstance;
/** `<executing agent>: <prompt first line>` per spawn. */
const spawns: string[] = [];

function worker(agent: AgentConfig): HarnessAdapter {
  const inner = new FakeAdapter({ providerSessionId: 'ses', events: buildFixtureEvents({ profileId: 'cp' }) });
  return {
    id: 'fake',
    capabilities: () => inner.capabilities(),
    createProfile: (a) => inner.createProfile(a),
    translate: (r) => inner.translate(r),
    spawn(opts: SpawnOptions) {
      spawns.push(`${agent.id}: ${opts.objective.split('\n')[0] ?? ''}`);
      if (opts.workdir !== undefined) writeFileSync(path.join(opts.workdir, `${agent.id}.txt`), `${opts.objective.split('\n')[0] ?? ''}\n`);
      return inner.spawn(opts);
    },
  };
}

const q = 'workspaceId=ws&agentId=dev';

async function runToEnd(id: string): Promise<{ tasks: Array<{ id: string; status: string }> }> {
  await app.inject({ method: 'POST', url: `/v1/objectives/${id}/start?${q}` });
  await delay(30);
  for (let i = 0; i < 400; i++) {
    const s = (await app.inject({ url: `/v1/objectives/${id}?${q}` })).json().data;
    if (!s.running) return s;
    await delay(20);
  }
  throw new Error(`${id} did not settle`);
}

beforeEach(async () => {
  spawns.length = 0;
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-deleg-'));
  repo = await mkdtemp(path.join(os.tmpdir(), 'aeos-deleg-repo-'));
  git(repo, 'init', '--quiet', '-b', 'main');
  writeFileSync(path.join(repo, 'README.md'), '# app\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=u', '-c', 'user.email=u@u', 'commit', '--quiet', '-m', 'init');
  app = await createApiServer({
    home,
    adapterFor: (agent) => worker(agent),
    credentialFor: () => CredentialProfileSchema.parse({ id: 'cp', kind: 'api-key', secretRef: 'x' }),
    bus: createEventBus(),
    notify: false,
  });
  await app.inject({ method: 'POST', url: '/v1/workspaces', payload: { id: 'ws', name: 'W' } });
  for (const [id, name] of [
    ['dev', 'Dev'],
    ['reviewer', 'Rita Reviewer'],
  ] as const) {
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      payload: { id, workspaceId: 'ws', name, harness: { provider: 'claude-code', featureToggles: {} }, credentialProfileId: 'cp' },
    });
  }
  await app.inject({ method: 'POST', url: `/v1/agents/dev/repos?workspaceId=ws`, payload: { id: 'app', path: repo } });
});
afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

async function createObjective(id: string, plan: string): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/v1/objectives',
    payload: { workspaceId: 'ws', agentId: 'dev', id, title: `Objective ${id}`, repo: 'app', tasks: [{ id: 'T1', title: 'x' }] },
  });
  writeFileSync(path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'objectives', id, 'plan.md'), plan);
}

describe('delegation (P3.M5.T2)', () => {
  it('an @agent task runs as that agent in the same worktree and its commit is authored by it', async () => {
    await createObjective('o1', '# o1\n\n- [ ] **T1** Build the feature\n- [ ] **T2** [review] @reviewer Review the feature\n');
    const s = await runToEnd('o1');
    expect(s.tasks.map((t) => `${t.id}:${t.status}`)).toEqual(['T1:completed', 'T2:completed']);
    expect(spawns).toEqual(['dev: Build the feature', 'reviewer: Review the feature']);

    // both tasks landed on the objective's one branch, each authored by its executor
    const log = git(repo, 'log', '--format=%an <%ae>|%s', 'aeos/dev/o1', '-n', '2').split('\n');
    expect(log).toEqual(['Rita Reviewer <reviewer@agents.aeos.local>|T2: Review the feature', 'Dev <dev@agents.aeos.local>|T1: Build the feature']);
    expect(git(repo, 'log', '-1', '--format=%b', 'aeos/dev/o1')).toContain('(delegated by dev)');
    // the delegate saw the owner's work (same worktree)
    expect(git(repo, 'show', 'aeos/dev/o1:dev.txt')).toBe('Build the feature');
    expect(git(repo, 'show', 'aeos/dev/o1:reviewer.txt')).toBe('Review the feature');
  });

  it('a task delegated to an unknown agent is refused without running anything', async () => {
    await createObjective('o2', '# o2\n\n- [ ] **T1** @ghost Build it\n');
    await app.inject({ method: 'POST', url: `/v1/objectives/o2/start?${q}` });
    await delay(300);
    expect(spawns).toEqual([]);
    const s = (await app.inject({ url: `/v1/objectives/o2?${q}` })).json().data as { running: boolean; tasks: Array<{ status: string }> };
    expect(s.running).toBe(false);
    expect(s.tasks[0]?.status).not.toBe('completed');
  });
});
