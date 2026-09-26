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
import {
  FakeAdapter,
  buildFixtureEvents,
  type HarnessAdapter,
  type SpawnOptions,
} from '@aeos/provider-core';
import { createApiServer } from '../src/index.js';

let home: string;
let repo: string;
let app: FastifyInstance;
const prompts: string[] = [];
const workdirs: Array<string | undefined> = [];

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** Fake harness that "does work": writes a file named after the task into its cwd. */
function workingAdapter(): HarnessAdapter {
  const inner = new FakeAdapter({
    providerSessionId: 'ses_wt',
    events: buildFixtureEvents({ profileId: 'cp-default' }),
  });
  return {
    id: inner.id,
    capabilities: () => inner.capabilities(),
    createProfile: (agent) => inner.createProfile(agent),
    translate: (raw) => inner.translate(raw),
    spawn(opts: SpawnOptions) {
      prompts.push(opts.objective);
      workdirs.push(opts.workdir);
      if (opts.workdir !== undefined) {
        const taskLine = opts.objective.split('\n')[0] ?? 'task';
        const name = `${taskLine.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`;
        writeFileSync(path.join(opts.workdir, name), `${taskLine}\n`);
      }
      return inner.spawn(opts);
    },
  };
}

beforeEach(async () => {
  prompts.length = 0;
  workdirs.length = 0;
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-wt-home-'));
  repo = await mkdtemp(path.join(os.tmpdir(), 'aeos-wt-repo-'));
  git(repo, 'init', '--quiet', '-b', 'main');
  writeFileSync(path.join(repo, 'README.md'), '# user project\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Kabeer', '-c', 'user.email=k@example.com', 'commit', '--quiet', '-m', 'init');
  app = await createApiServer({
    home,
    adapterFor: () => workingAdapter(),
    credentialFor: () =>
      CredentialProfileSchema.parse({ id: 'cp-default', kind: 'api-key', secretRef: 'anthropic/main' }),
    bus: createEventBus(),
  });
  await app.inject({ method: 'POST', url: '/v1/workspaces', payload: { id: 'ws1', name: 'W' } });
  await app.inject({
    method: 'POST',
    url: '/v1/agents',
    payload: {
      id: 'agent1',
      workspaceId: 'ws1',
      name: 'Agent One',
      harness: { provider: 'claude-code', featureToggles: {} },
      credentialProfileId: 'cp-default',
    },
  });
});

afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

async function waitForCompletion(objectiveId: string): Promise<{ tasks: Array<{ id: string; status: string }>; checkpoints: Array<{ taskId: string; commit?: string }> }> {
  for (let i = 0; i < 200; i += 1) {
    const status = (
      await app.inject({ url: `/v1/objectives/${objectiveId}?workspaceId=ws1&agentId=agent1` })
    ).json().data;
    if (!status.running && status.tasks.every((t: { status: string }) => t.status === 'completed')) return status;
    await delay(20);
  }
  throw new Error('objective did not complete');
}

describe('repo bindings + per-objective worktrees (P2.M9.T1)', () => {
  it('binds only absolute git repositories', async () => {
    const relative = await app.inject({
      method: 'POST',
      url: '/v1/agents/agent1/repos?workspaceId=ws1',
      payload: { id: 'app', path: 'relative/path' },
    });
    expect(relative.statusCode).toBe(400);
    const notGit = await app.inject({
      method: 'POST',
      url: '/v1/agents/agent1/repos?workspaceId=ws1',
      payload: { id: 'app', path: os.tmpdir() + '/definitely-not-a-repo-aeos' },
    });
    expect(notGit.statusCode).toBe(400);
  });

  it('accept: objective runs in its own worktree on an agent branch; the checkout is untouched; each task is committed', async () => {
    const bound = await app.inject({
      method: 'POST',
      url: '/v1/agents/agent1/repos?workspaceId=ws1',
      payload: { id: 'app', path: repo },
    });
    expect(bound.statusCode).toBe(201);
    expect(bound.json().data.repos).toEqual([{ id: 'app', path: repo }]);

    const unknownRepo = await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: { workspaceId: 'ws1', agentId: 'agent1', id: 'o0', title: 'x', repo: 'nope', tasks: [{ id: 'T1', title: 'x' }] },
    });
    expect(unknownRepo.statusCode).toBe(400);

    await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: {
        workspaceId: 'ws1',
        agentId: 'agent1',
        id: 'obj1',
        title: 'Add greeting',
        definitionOfDone: 'greeting files exist',
        repo: 'app',
        tasks: [
          { id: 'T1', title: 'Write hello' },
          { id: 'T2', title: 'Write goodbye' },
        ],
      },
    });
    await app.inject({ method: 'POST', url: '/v1/objectives/obj1/start?workspaceId=ws1&agentId=agent1' });
    const status = await waitForCompletion('obj1');

    const worktree = path.join(home, 'workspaces', 'ws1', 'agents', 'agent1', 'worktrees', 'app', 'obj1');
    expect(workdirs).toEqual([worktree, worktree]);
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('aeos/agent1/obj1');
    expect(existsSync(path.join(worktree, 'write-hello.txt'))).toBe(true);
    // the user's checkout never sees agent work
    expect(existsSync(path.join(repo, 'write-hello.txt'))).toBe(false);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

    const commits = status.checkpoints.map((c) => c.commit);
    expect(commits.every((c) => typeof c === 'string' && c.length === 40)).toBe(true);
    expect(git(worktree, 'log', '--format=%an|%s', '-2')).toBe('Agent One|T2: Write goodbye\nAgent One|T1: Write hello');
  });

  it('session brief carries the task, objective context and worktree', async () => {
    await app.inject({ method: 'POST', url: '/v1/agents/agent1/repos?workspaceId=ws1', payload: { id: 'app', path: repo } });
    await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: {
        workspaceId: 'ws1',
        agentId: 'agent1',
        id: 'obj2',
        title: 'Ship it',
        definitionOfDone: 'tests pass',
        repo: 'app',
        tasks: [
          { id: 'T1', title: 'Write code' },
          { id: 'T2', title: 'Write tests' },
        ],
      },
    });
    await app.inject({ method: 'POST', url: '/v1/objectives/obj2/start?workspaceId=ws1&agentId=agent1' });
    await waitForCompletion('obj2');
    const [first, second] = prompts;
    expect(first?.split('\n')[0]).toBe('Write code');
    expect(first).toContain('- Objective: Ship it');
    expect(first).toContain('- Definition of done: tests pass');
    expect(first).toContain('- Current task: T1 (1 of 2)');
    expect(first).toContain('Later tasks (do not start them now): T2 Write tests');
    expect(first).toContain('branch `aeos/agent1/obj2`');
    expect(second).toContain('already completed: T1');
  });
});

describe('review pane backend (P2.M9.T3)', () => {
  it('diffs the worktree by scope and sends comments back as a new task', async () => {
    await app.inject({ method: 'POST', url: '/v1/agents/agent1/repos?workspaceId=ws1', payload: { id: 'app', path: repo } });
    await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: { workspaceId: 'ws1', agentId: 'agent1', id: 'obj3', title: 'Feature', repo: 'app', tasks: [{ id: 'T1', title: 'Build feature' }] },
    });
    await app.inject({ method: 'POST', url: '/v1/objectives/obj3/start?workspaceId=ws1&agentId=agent1' });
    await waitForCompletion('obj3');

    const branch = (
      await app.inject({ url: '/v1/objectives/obj3/diff?workspaceId=ws1&agentId=agent1&scope=branch' })
    ).json().data;
    expect(branch.branch).toBe('aeos/agent1/obj3');
    expect(branch.diff).toContain('+++ b/build-feature.txt');

    const worktree = branch.worktree as string;
    writeFileSync(path.join(worktree, 'scratch.txt'), 'uncommitted\n');
    const uncommitted = (
      await app.inject({ url: '/v1/objectives/obj3/diff?workspaceId=ws1&agentId=agent1&scope=uncommitted' })
    ).json().data;
    expect(uncommitted.diff).toContain('+++ b/scratch.txt');
    expect(uncommitted.diff).not.toContain('build-feature.txt');
    execFileSync('rm', [path.join(worktree, 'scratch.txt')]);
    git(worktree, 'reset', '--quiet');

    const review = await app.inject({
      method: 'POST',
      url: '/v1/objectives/obj3/review?workspaceId=ws1&agentId=agent1',
      payload: {
        comments: [
          { file: 'build-feature.txt', line: 1, body: 'Say "Feature built" instead' },
          { body: 'Add a changelog entry' },
        ],
      },
    });
    expect(review.statusCode).toBe(201);
    expect(review.json().data).toMatchObject({ taskId: 'R1', started: true });
    const status = await waitForCompletion('obj3');
    expect(status.tasks.map((t) => t.id)).toEqual(['T1', 'R1']);

    const reviewPrompt = prompts.at(-1) ?? '';
    expect(reviewPrompt.split('\n')[0]).toBe('Address review feedback (2 comments)');
    expect(reviewPrompt).toContain('`build-feature.txt:1`: Say "Feature built" instead');
    expect(reviewPrompt).toContain('General: Add a changelog entry');
    const plan = readFileSync(
      path.join(home, 'workspaces', 'ws1', 'agents', 'agent1', 'objectives', 'obj3', 'plan.md'),
      'utf8',
    );
    expect(plan).toContain('- [x] **R1** Address review feedback (2 comments)');

    const missing = await app.inject({ url: '/v1/objectives/obj3/diff?workspaceId=ws1&agentId=agent1&scope=bogus' });
    expect(missing.statusCode).toBe(400);
  });
});
