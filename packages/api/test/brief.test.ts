import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigSchema } from '@aeos/contracts';
import { initMemoryLayout } from '@aeos/memory';
import { parsePlan } from '@aeos/scheduler';
import { composeSessionBrief } from '../src/brief.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aeos-brief-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const agent = AgentConfigSchema.parse({
  id: 'a1',
  workspaceId: 'w1',
  name: 'A',
  harness: { provider: 'claude-code', featureToggles: {} },
  credentialProfileId: 'cp',
});
const plan = parsePlan('# O\n\n- [x] **T1** Scaffold\n- [ ] **T2** Implement parser\n');
const task = plan.tasks[1]!;

describe('session brief (P2.M9.T2)', () => {
  it('injects the frozen memory snapshot and is byte-stable for identical inputs', async () => {
    const memoryRoot = path.join(root, 'memory');
    await initMemoryLayout(memoryRoot);
    await writeFile(path.join(memoryRoot, 'preferences', 'style.md'), 'Prefer small pure functions.\n');
    const input = { agent, objectiveTitle: 'O', objective: undefined, task, plan, memoryRoot };
    const first = await composeSessionBrief(input);
    const second = await composeSessionBrief(input);
    expect(second).toBe(first);
    expect(first.startsWith('Implement parser\n')).toBe(true);
    expect(first).toContain('# Agent memory snapshot');
    expect(first).toContain('Prefer small pure functions.');
    expect(first).toContain('- Current task: T2 (2 of 2); already completed: T1');
  });

  it('omits the memory section when the agent has none yet', async () => {
    const brief = await composeSessionBrief({
      agent,
      objectiveTitle: 'O',
      objective: undefined,
      task,
      plan,
      memoryRoot: path.join(root, 'nope'),
    });
    expect(brief).not.toContain('memory snapshot');
  });
});
