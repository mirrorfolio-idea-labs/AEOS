import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigSchema, type AeosEvent, type AgentConfig } from '@aeos/contracts';
import { writeFileAtomic } from '@aeos/kernel';
import {
  FakeAdapter,
  buildFixtureEvents,
  type HarnessAdapter,
  type SessionHandle,
  type SpawnOptions,
} from '@aeos/provider-core';
import { readCheckpoints, runObjective } from '../src/index.js';

const agent: AgentConfig = AgentConfigSchema.parse({
  id: 'sched-agent',
  workspaceId: 'ws-1',
  name: 'Scheduler Agent',
  harness: { provider: 'claude-code', featureToggles: {} },
  credentialProfileId: 'cp-default',
});

const PLAN = ['# Objective plan', '', '- [ ] **T1** first task', '- [ ] **T2** second task', '- [ ] **T3** third task', ''].join('\n');

/** Wraps an adapter, counting spawns per objective title. */
function counting(adapter: HarnessAdapter): { adapter: HarnessAdapter; spawns: Map<string, number> } {
  const spawns = new Map<string, number>();
  return {
    spawns,
    adapter: {
      id: adapter.id,
      capabilities: () => adapter.capabilities(),
      createProfile: (a) => adapter.createProfile(a),
      translate: (raw) => adapter.translate(raw),
      spawn: (opts: SpawnOptions): SessionHandle => {
        spawns.set(opts.objective, (spawns.get(opts.objective) ?? 0) + 1);
        return adapter.spawn(opts);
      },
    },
  };
}

const goodAdapter = () =>
  new FakeAdapter({
    providerSessionId: 'ses_ok',
    events: buildFixtureEvents({ profileId: 'cp-default' }),
  });

const failingAdapter = () =>
  new FakeAdapter({
    providerSessionId: 'ses_bad',
    events: buildFixtureEvents({ profileId: 'cp-default' }),
    exit: 'fail',
    failureReason: 'simulated harness crash',
  });

let objectiveDir: string;

beforeEach(async () => {
  objectiveDir = await mkdtemp(path.join(os.tmpdir(), 'aeos-objective-'));
  await mkdir(path.join(objectiveDir, 'checkpoints'), { recursive: true });
  await writeFileAtomic(path.join(objectiveDir, 'plan.md'), PLAN);
});

afterEach(async () => {
  await rm(objectiveDir, { recursive: true, force: true });
});

describe('sequential scheduler loop (T3)', () => {
  it('completes a 3-task plan on provider-fake, checkpointing costs + resume tokens', async () => {
    const { adapter, spawns } = counting(goodAdapter());
    const events: AeosEvent[] = [];
    const outcome = await runObjective({
      objectiveDir,
      agent,
      adapter,
      onEvent: (e) => events.push(e),
    });
    expect(outcome).toEqual({ status: 'completed' });
    expect([...spawns.values()]).toEqual([1, 1, 1]);

    const planAfter = await readFile(path.join(objectiveDir, 'plan.md'), 'utf8');
    expect(planAfter).toContain('- [x] **T1** first task');
    expect(planAfter).toContain('- [x] **T3** third task');

    const checkpoints = await readCheckpoints(objectiveDir);
    for (const id of ['T1', 'T2', 'T3']) {
      const checkpoint = checkpoints.get(id);
      expect(checkpoint?.status).toBe('completed');
      expect(checkpoint?.costs.usd).toBeCloseTo(0.0042);
      expect(checkpoint?.costs.tokens).toBe(1540);
      expect(checkpoint?.providerResumeToken).toBe('ses_ok');
    }
    expect(events.some((e) => e.type === 'session.completed')).toBe(true);
  });

  it('induced failure blocks the task after 3 strikes, pauses, and emits approval.request', async () => {
    const { adapter, spawns } = counting(failingAdapter());
    const backoffs: number[] = [];
    const events: AeosEvent[] = [];
    const outcome = await runObjective({
      objectiveDir,
      agent,
      adapter,
      backoff: (attempt) => {
        backoffs.push(attempt);
        return Promise.resolve();
      },
      onEvent: (e) => events.push(e),
    });
    expect(outcome.status).toBe('paused');
    expect(outcome.status === 'paused' && outcome.taskId).toBe('T1');
    expect(spawns.get('first task')).toBe(3);
    expect(backoffs).toEqual([1, 2]);

    const planAfter = await readFile(path.join(objectiveDir, 'plan.md'), 'utf8');
    expect(planAfter).toContain('- [!] **T1** first task');
    expect(planAfter).toContain('- [ ] **T2** second task');

    const pause = events.at(-1);
    expect(pause?.type).toBe('approval.request');
    expect(pause?.type === 'approval.request' && pause.payload.action).toBe('objective.resume');
    expect((await readCheckpoints(objectiveDir)).get('T1')?.status).toBe('blocked');
  });
});

describe('resume-on-boot (T4)', () => {
  it('a fresh scheduler over the same files resumes without re-running completed tasks', async () => {
    // crash rig: T1 completes, then the adapter dies before T2 can finish
    let calls = 0;
    const crashing: HarnessAdapter = {
      ...goodAdapter(),
      capabilities: () => goodAdapter().capabilities(),
      createProfile: (a) => goodAdapter().createProfile(a),
      translate: (raw) => goodAdapter().translate(raw),
      spawn: (opts) => {
        calls += 1;
        if (calls >= 2) throw new Error('simulated hard crash (SIGKILL stand-in)');
        return goodAdapter().spawn(opts);
      },
    };
    await expect(
      runObjective({ objectiveDir, agent, adapter: crashing }),
    ).rejects.toThrow('simulated hard crash');

    // T1 is checkpointed; T2/T3 are not
    const mid = await readCheckpoints(objectiveDir);
    expect(mid.get('T1')?.status).toBe('completed');
    expect(mid.get('T2')?.status).toBe('in_progress');

    // "reboot": brand-new scheduler instance, fresh adapter, same directory
    const { adapter, spawns } = counting(goodAdapter());
    const outcome = await runObjective({ objectiveDir, agent, adapter });
    expect(outcome).toEqual({ status: 'completed' });
    // completed T1 was never re-spawned; T2 and T3 ran exactly once each
    expect(spawns.get('first task')).toBeUndefined();
    expect(spawns.get('second task')).toBe(1);
    expect(spawns.get('third task')).toBe(1);

    const planAfter = await readFile(path.join(objectiveDir, 'plan.md'), 'utf8');
    for (const id of ['T1', 'T2', 'T3']) expect(planAfter).toContain(`- [x] **${id}**`);
  });
});
