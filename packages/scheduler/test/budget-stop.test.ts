import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AeosEventSchema, newEventId, type AeosEvent } from '@aeos/contracts';
import { writeFileAtomic } from '@aeos/kernel';
import type { HarnessAdapter } from '@aeos/provider-core';
import { runObjective } from '../src/index.js';
import { readCheckpoints } from '../src/checkpoint.js';

/**
 * P2.M2.T1 accept: simulated spend crossing the cap HARD-STOPS with a
 * checkpoint written — and without consuming a 3-strike attempt.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-budget-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function seedPlan(): void {
  writeFileAtomic(
    path.join(dir, 'plan.md'),
    '# T\n\n- [ ] **T1** spendy task\n',
  );
}

/** Fake that emits $0.02 of usage then completes. */
const SpendyAdapter = (): HarnessAdapter => {
  const events: AeosEvent[] = AeosEventSchema.array().parse([
    {
      v: 1, id: newEventId(), ts: '2026-08-25T00:00:00.000Z', source: 'fake',
      type: 'session.created', payload: {},
    },
    {
      v: 1, id: newEventId(), ts: '2026-08-25T00:00:01.000Z', source: 'fake',
      type: 'cost.usage',
      payload: { profileId: 'cp', usd: 0.02, inputTokens: 100, outputTokens: 10 },
    },
    {
      v: 1, id: newEventId(), ts: '2026-08-25T00:00:02.000Z', source: 'fake',
      type: 'session.completed', payload: {},
    },
  ]);
  return {
    id: 'spendy',
    capabilities: () => ({
      resume: true, structuredOutput: true, mcp: false, sandbox: false, costReporting: true,
    }),
    createProfile: () => Promise.resolve({ rootDir: '/tmp/x', env: {}, argv: [] }),
    spawn: () => ({
      events: (async function* () {
        for (const event of events) yield event;
      })(),
      providerSessionId: 'ses_x',
      resumeToken: 'tok_1',
      costUsd: 0.02,
      kill: () => undefined,
    }),
    translate: () => [],
  };
};

describe('budget hard-stop (P2.M2.T1)', () => {
  it('crossing the usd cap pauses with a pending checkpoint and emits budget.exceeded', async () => {
    seedPlan();
    const emitted: AeosEvent[] = [];
    const outcome = await runObjective({
      objectiveDir: dir,
      agent: {
        id: 'ada', workspaceId: 'ws', name: 'A',
        harness: { provider: 'claude-code' }, credentialProfileId: 'cp',
      } as never,
      adapter: SpendyAdapter(),
      budget: { usdCap: 0.01 },
      onEvent: (event) => emitted.push(event),
    });

    expect(outcome).toEqual({
      status: 'paused',
      taskId: 'T1',
      reason: 'budget usd cap reached',
    });

    const checkpoints = await readCheckpoints(dir);
    const checkpoint = checkpoints.get('T1');
    expect(checkpoint?.status).toBe('pending');
    expect(checkpoint?.attempts).toBe(0); // NOT a strike
    expect(checkpoint?.summary).toContain('hard-stopped');

    const exceeded = emitted.find((e) => e.type === 'budget.exceeded');
    expect(exceeded?.type === 'budget.exceeded' && exceeded.payload.kind).toBe('usd');
    expect(exceeded?.type === 'budget.exceeded' && exceeded.payload.cap).toBe(0.01);
  });

  it('a cap high enough lets the same objective complete untouched', async () => {
    seedPlan();
    const outcome = await runObjective({
      objectiveDir: dir,
      agent: {
        id: 'ada', workspaceId: 'ws', name: 'A',
        harness: { provider: 'claude-code' }, credentialProfileId: 'cp',
      } as never,
      adapter: SpendyAdapter(),
      budget: { usdCap: 1.0 },
    });
    expect(outcome.status).toBe('completed');
  });

  it('reads caps from objective.yaml when opts.budget is absent', async () => {
    seedPlan();
    writeFileAtomic(
      path.join(dir, 'objective.yaml'),
      'id: obj-1\nagentId: ada\ntitle: T\nbudgetUsd: 0.005\n',
    );
    const outcome = await runObjective({
      objectiveDir: dir,
      agent: {
        id: 'ada', workspaceId: 'ws', name: 'A',
        harness: { provider: 'claude-code' }, credentialProfileId: 'cp',
      } as never,
      adapter: SpendyAdapter(),
    });
    expect(outcome.status).toBe('paused');
    expect(outcome).toHaveProperty('reason');
  });
});
