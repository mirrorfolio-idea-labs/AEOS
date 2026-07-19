import { describe, expect, it } from 'vitest';
import { parsePlan, serializePlan, withTaskStatus } from '../src/index.js';

/** Deterministic LCG so the property test is reproducible without Math.random. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const STATUSES = ['pending', 'completed', 'in_progress', 'blocked'] as const;

function generatePlan(rand: () => number) {
  const tasks = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => ({
    id: `T${i + 1}`,
    title: `task number ${i + 1} with words ${Math.floor(rand() * 1000)}`,
    status: STATUSES[Math.floor(rand() * STATUSES.length)] as (typeof STATUSES)[number],
  }));
  const lines: string[] = ['# Plan', ''];
  for (const task of tasks) {
    if (rand() > 0.7) lines.push(`some prose the human wrote ${Math.floor(rand() * 100)}`);
    const marker = { pending: ' ', completed: 'x', in_progress: '~', blocked: '!' }[task.status];
    lines.push(`- [${marker}] **${task.id}** ${task.title}`);
  }
  lines.push('', '> trailing note');
  return { markdown: lines.join('\n'), tasks };
}

describe('plan parser/writer (T1)', () => {
  it('property: parse→serialize→parse is stable for 50 generated plans', () => {
    const rand = lcg(42);
    for (let round = 0; round < 50; round++) {
      const { markdown, tasks } = generatePlan(rand);
      const parsed = parsePlan(markdown);
      expect(parsed.tasks).toEqual(tasks);
      const serialized = serializePlan(parsed);
      expect(serialized).toBe(markdown);
      expect(parsePlan(serialized).tasks).toEqual(tasks);
    }
  });

  it('tolerates hand-mangled human edits', () => {
    const mangled = [
      '# messy plan',
      '  -  [X]  **T1**   shouty completed task   ',
      '- [] T2: colon-style id with no marker char',
      '- [~]    **T3**    extra   spaces preserved in title? yes',
      'random prose that stays',
      '- [!] **T4.sub-2** punctuated.id-forms_work',
    ].join('\n');
    const parsed = parsePlan(mangled);
    expect(parsed.tasks.map((t) => [t.id, t.status])).toEqual([
      ['T1', 'completed'],
      ['T2', 'pending'],
      ['T3', 'in_progress'],
      ['T4.sub-2', 'blocked'],
    ]);
    // non-task prose survives verbatim
    expect(serializePlan(parsed)).toContain('random prose that stays');
  });

  it('withTaskStatus updates immutably and serializes the new marker', () => {
    const plan = parsePlan('- [ ] **T1** first\n- [ ] **T2** second');
    const updated = withTaskStatus(plan, 'T2', 'completed');
    expect(plan.tasks[1]?.status).toBe('pending');
    expect(serializePlan(updated)).toContain('- [x] **T2** second');
    expect(() => withTaskStatus(plan, 'T9', 'completed')).toThrow('T9');
  });
});
