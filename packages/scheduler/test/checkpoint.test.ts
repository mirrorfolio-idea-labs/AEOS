import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Checkpoint } from '@aeos/contracts';
import {
  parsePlan,
  readCheckpoints,
  resolveNextTask,
  writeCheckpoint,
} from '../src/index.js';

const plan = parsePlan(['- [ ] **T1** first', '- [ ] **T2** second', '- [ ] **T3** third'].join('\n'));

const cp = (taskId: string, status: Checkpoint['status'], attempts = 0): Checkpoint => ({
  taskId,
  status,
  attempts,
  summary: 's',
  costs: { usd: 0, tokens: 0 },
});

describe('checkpoint store + recovery resolver (T2)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'aeos-ckpt-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips checkpoints through yaml files', async () => {
    await writeCheckpoint(dir, { ...cp('T1', 'completed', 1), providerResumeToken: 'ses_1' });
    const read = await readCheckpoints(dir);
    expect(read.get('T1')?.providerResumeToken).toBe('ses_1');
    expect(read.get('T1')?.attempts).toBe(1);
  });

  it('crash-point matrix resolves to the correct next task', () => {
    const cases: Array<{ checkpoints: Checkpoint[]; expected: string }> = [
      { checkpoints: [], expected: 'run:T1' },
      { checkpoints: [cp('T1', 'completed')], expected: 'run:T2' },
      // crashed mid-task: in_progress checkpoint, plan may still say pending
      { checkpoints: [cp('T1', 'in_progress', 0)], expected: 'run:T1' },
      { checkpoints: [cp('T1', 'completed'), cp('T2', 'in_progress', 1)], expected: 'run:T2' },
      // failed twice → still runnable under maxAttempts 3
      { checkpoints: [cp('T1', 'pending', 2)], expected: 'run:T1' },
      // exhausted → paused
      { checkpoints: [cp('T1', 'pending', 3)], expected: 'paused:T1' },
      { checkpoints: [cp('T1', 'blocked', 3)], expected: 'paused:T1' },
      {
        checkpoints: [cp('T1', 'completed'), cp('T2', 'completed'), cp('T3', 'completed')],
        expected: 'done',
      },
    ];
    for (const { checkpoints, expected } of cases) {
      const map = new Map(checkpoints.map((c) => [c.taskId, c]));
      const resolution = resolveNextTask(plan, map, 3);
      const actual =
        resolution.kind === 'done' ? 'done' : `${resolution.kind}:${resolution.task.id}`;
      expect(actual, JSON.stringify(checkpoints)).toBe(expected);
    }
  });

  it('checkpoints override stale plan markers (checkpoint is the later truth)', () => {
    const stalePlan = parsePlan('- [~] **T1** crashed mid-flight\n- [ ] **T2** next');
    const map = new Map([['T1', cp('T1', 'completed', 1)]]);
    const resolution = resolveNextTask(stalePlan, map, 3);
    expect(resolution.kind === 'run' && resolution.task.id).toBe('T2');
  });

  it('passes the previous resume token back for continuation', () => {
    const map = new Map([['T1', { ...cp('T1', 'in_progress'), providerResumeToken: 'ses_x' }]]);
    const resolution = resolveNextTask(plan, map, 3);
    expect(resolution.kind === 'run' && resolution.resumeToken).toBe('ses_x');
  });
});
