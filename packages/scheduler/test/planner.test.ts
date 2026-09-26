import { describe, expect, it } from 'vitest';
import { AgentConfigSchema } from '@aeos/contracts';
import { FakeAdapter, buildFixtureEvents } from '@aeos/provider-core';
import {
  PLANNING_MARKER,
  PlanningError,
  composePlanningPrompt,
  extractPlanTasks,
  generatePlan,
  interleaveVerify,
  parsePlan,
  renderPlanMarkdown,
  serializePlan,
} from '../src/index.js';

describe('plan grammar with task classes (P3.M1.T1)', () => {
  it('parses [class] and @agent, defaults to implement, and round-trips', () => {
    const md = [
      '# O',
      '- [ ] **T1** [architect] Design the cache',
      '- [ ] **T2** Implement it',
      '- [x] **T3** [review] @reviewer Review the diff',
      '- [ ] **T4** [notaclass] keeps brackets in the title',
    ].join('\n');
    const plan = parsePlan(md);
    expect(plan.tasks.map((t) => [t.id, t.taskClass, t.agent, t.title])).toEqual([
      ['T1', 'architect', undefined, 'Design the cache'],
      ['T2', 'implement', undefined, 'Implement it'],
      ['T3', 'review', 'reviewer', 'Review the diff'],
      ['T4', 'implement', undefined, '[notaclass] keeps brackets in the title'],
    ]);
    expect(serializePlan(plan)).toBe(md);
  });
});

describe('planner (P3.M1.T2)', () => {
  it('prompt starts with the marker and carries objective + definition of done', () => {
    const prompt = composePlanningPrompt({ objectiveTitle: 'Add CSV export', definitionOfDone: 'tests pass' });
    expect(prompt.startsWith(PLANNING_MARKER)).toBe(true);
    expect(prompt).toContain('Objective: Add CSV export');
    expect(prompt).toContain('Definition of done: tests pass');
    expect(prompt).not.toContain('verify,'); // verify is daemon-owned
  });

  it('extracts task lines from prose, resets status, rejects junk', () => {
    const tasks = extractPlanTasks('Sure!\n```\n- [x] **T1** [implement] Do it\n- [ ] **T2** [verify] sneaky\n```\nThanks');
    expect(tasks.map((t) => [t.id, t.status, t.taskClass])).toEqual([
      ['T1', 'pending', 'implement'],
      ['T2', 'pending', 'implement'],
    ]);
    expect(() => extractPlanTasks('no plan here')).toThrow(PlanningError);
    expect(() => extractPlanTasks('- [ ] **T1** a\n- [ ] **T1** b')).toThrow(/repeats/);
  });

  it('interleaves a verify task after every code-changing task (P3.M3.T2)', () => {
    const tasks = extractPlanTasks('- [ ] **T1** [architect] a\n- [ ] **T2** b\n- [ ] **T3** [refactor] c\n- [ ] **T4** [docs] d');
    expect(interleaveVerify(tasks).map((t) => `${t.id}:${t.taskClass}`)).toEqual([
      'T1:architect',
      'T2:implement',
      'V1:verify',
      'T3:refactor',
      'V2:verify',
      'T4:docs',
    ]);
  });

  it('accept: a provider-fake objective yields a valid classed plan', async () => {
    const agent = AgentConfigSchema.parse({
      id: 'a',
      workspaceId: 'w',
      name: 'A',
      harness: { provider: 'claude-code', featureToggles: {} },
      credentialProfileId: 'cp',
    });
    const adapter = new FakeAdapter({
      providerSessionId: 'p',
      events: buildFixtureEvents({ profileId: 'cp' }),
      respond: (prompt) =>
        prompt.startsWith(PLANNING_MARKER) ? '- [ ] **T1** [architect] Design\n- [ ] **T2** [implement] Build' : undefined,
    });
    const plan = await generatePlan({ adapter, agent, sessionId: 's', prompt: composePlanningPrompt({ objectiveTitle: 'X' }) });
    expect(plan.tasks.map((t) => t.taskClass)).toEqual(['architect', 'implement']);
    expect(plan.usd).toBeGreaterThan(0);
    const md = renderPlanMarkdown('X', plan.tasks);
    expect(parsePlan(md).tasks).toEqual(plan.tasks);
  });
});
