import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigSchema, type AeosEvent, type AgentConfig } from '@aeos/contracts';
import { writeFileAtomic } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents } from '@aeos/provider-core';
import { readCheckpoints, runObjective } from '../src/index.js';

const run = promisify(execFile);

const agent: AgentConfig = AgentConfigSchema.parse({
  id: 'sched-agent',
  workspaceId: 'ws-1',
  name: 'Scheduler Agent',
  harness: { provider: 'claude-code', featureToggles: {} },
  credentialProfileId: 'cp-default',
});

const PLAN = ['# Objective plan', '', '- [ ] **T1** first task', '- [ ] **T2** second task', ''].join('\n');

const goodAdapter = () =>
  new FakeAdapter({
    providerSessionId: 'ses_ok',
    events: buildFixtureEvents({ profileId: 'cp-default' }),
  });

/**
 * P2.M5.T3 accept: a human edit in the watched repo mid-task pauses the
 * task behind an approval.request (ADR-009) — kill-switch semantics, no
 * strike; resuming on a clean tree completes the plan.
 */
describe('co-edit guard (P2.M5.T3)', () => {
  let objectiveDir: string;
  let repo: string;

  beforeEach(async () => {
    objectiveDir = await mkdtemp(path.join(os.tmpdir(), 'aeos-objective-'));
    await mkdir(path.join(objectiveDir, 'checkpoints'), { recursive: true });
    await writeFileAtomic(path.join(objectiveDir, 'plan.md'), PLAN);

    repo = await mkdtemp(path.join(os.tmpdir(), 'aeos-coedit-repo-'));
    await run('git', ['init', '-q'], { cwd: repo });
    await run('git', ['config', 'user.email', 'test@aeos.local'], { cwd: repo });
    await run('git', ['config', 'user.name', 'Aeos Test'], { cwd: repo });
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    await run('git', ['add', '.'], { cwd: repo });
    await run('git', ['commit', '-qm', 'init'], { cwd: repo });
  });

  afterEach(async () => {
    await rm(objectiveDir, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it('a foreign edit during the task pauses with an approval.request', async () => {
    const events: AeosEvent[] = [];
    let mutated = false;
    const outcome = await runObjective({
      objectiveDir,
      agent,
      adapter: goodAdapter(),
      watchedRepo: repo,
      onEvent: (e) => {
        events.push(e);
        if (!mutated && e.type === 'item.message') {
          mutated = true;
          void writeFile(path.join(repo, 'tracked.txt'), 'human was here\n').catch(() => undefined);
        }
      },
    });

    expect(outcome.status).toBe('paused');
    if (outcome.status !== 'paused') throw new Error('unreachable — narrowed for TS');
    expect(outcome.reason).toContain('co-edit');
    const request = events.find((e) => e.type === 'approval.request');
    expect(request).toBeDefined();
    expect((request!.payload as { action: string }).action).toBe('objective.resume');
    expect((request!.payload as { detail: string }).detail).toContain('tracked.txt');

    // resume on a clean tree completes the plan (no strike recorded)
    const outcome2 = await runObjective({
      objectiveDir,
      agent,
      adapter: goodAdapter(),
      watchedRepo: repo,
      onEvent: () => undefined,
    });
    expect(outcome2.status).toBe('completed');
    const checkpoints = await readCheckpoints(objectiveDir);
    expect(checkpoints.get('T1')?.status).toBe('completed');
  });

  it('an untouched tree completes normally without approvals', async () => {
    const events: AeosEvent[] = [];
    const outcome = await runObjective({
      objectiveDir,
      agent,
      adapter: goodAdapter(),
      watchedRepo: repo,
      onEvent: (e) => events.push(e),
    });
    expect(outcome.status).toBe('completed');
    expect(events.some((e) => e.type === 'approval.request')).toBe(false);
  });
});
