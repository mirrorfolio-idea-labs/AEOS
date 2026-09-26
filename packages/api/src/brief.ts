import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentConfig, Objective, PlanTask } from '@aeos/contracts';
import { composeSnapshot } from '@aeos/memory';
import type { ParsedPlan } from '@aeos/scheduler';

/** `tasks/<taskId>.md` — optional long-form task detail the brief carries. */
export const taskNotesPath = (objectiveDir: string, taskId: string): string =>
  path.join(objectiveDir, 'tasks', `${taskId}.md`);

export interface SessionBriefInput {
  agent: AgentConfig;
  /** Objective title from plan.md (objective.yaml may be absent). */
  objectiveTitle: string;
  objective: Objective | undefined;
  task: PlanTask;
  plan: ParsedPlan;
  /** `<agent>/memory` — skipped when the agent has no memory yet. */
  memoryRoot: string;
  worktree?: { dir: string; branch: string } | undefined;
  /** Contents of `tasks/<taskId>.md` (e.g. review feedback), placed right after the task. */
  taskNotes?: string | undefined;
  /** Snapshot char budget (spec §8 rule 2); defaults to 12k chars. */
  memoryBudget?: number;
}

/**
 * The prompt a task session starts from. The task instruction comes first
 * (it is what the harness acts on); the AEOS context block follows. Built
 * only from files + plan state, with no timestamps, so identical inputs give
 * byte-identical briefs and provider prompt caches stay warm (spec §8).
 */
export async function composeSessionBrief(input: SessionBriefInput): Promise<string> {
  const { task, plan } = input;
  const index = plan.tasks.findIndex((t) => t.id === task.id);
  const done = plan.tasks.filter((t) => t.status === 'completed').map((t) => t.id);
  const lines: string[] = [task.title, ''];
  if (input.taskNotes !== undefined && input.taskNotes.trim().length > 0) {
    lines.push(input.taskNotes.trimEnd(), '');
  }
  lines.push('---', '## AEOS context', '');
  lines.push(`- Objective: ${input.objectiveTitle}`);
  if (input.objective?.definitionOfDone !== undefined) {
    lines.push(`- Definition of done: ${input.objective.definitionOfDone}`);
  }
  lines.push(
    `- Current task: ${task.id} (${String(index + 1)} of ${String(plan.tasks.length)})` +
      (done.length > 0 ? `; already completed: ${done.join(', ')}` : ''),
  );
  const remaining = plan.tasks.filter((t) => t.status !== 'completed' && t.id !== task.id);
  if (remaining.length > 0) {
    lines.push(`- Later tasks (do not start them now): ${remaining.map((t) => `${t.id} ${t.title}`).join('; ')}`);
  }
  if (input.worktree !== undefined) {
    lines.push(
      `- Working tree: ${input.worktree.dir} (branch \`${input.worktree.branch}\`). Work only inside it.` +
        ' AEOS commits your changes when the task ends — do not push or switch branches.',
    );
  }
  if (existsSync(input.memoryRoot)) {
    const snapshot = await composeSnapshot(input.memoryRoot, {
      charBudget: input.memoryBudget ?? 12_000,
      relevance: task.title.split(/\s+/).filter((w) => w.length > 3),
    }).catch(() => undefined);
    if (snapshot !== undefined && snapshot.includedFiles.length > 0) {
      lines.push('', snapshot.text.trimEnd());
    }
  }
  return lines.join('\n') + '\n';
}
