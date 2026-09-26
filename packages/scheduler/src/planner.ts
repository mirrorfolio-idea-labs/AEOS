import { TASK_CLASSES, type AeosEvent, type AgentConfig, type CompiledPolicy, type PlanTask } from '@aeos/contracts';
import type { HarnessAdapter } from '@aeos/provider-core';
import { formatTaskText, parsePlan } from './plan.js';

/** First line of every planning prompt — lets fakes and logs recognise a planner call. */
export const PLANNING_MARKER = 'AEOS planning request';

export interface PlanningPromptInput {
  objectiveTitle: string;
  definitionOfDone?: string | undefined;
  /** Frozen memory snapshot / repo notes the planner should respect. */
  context?: string | undefined;
  /** Worktree the executing agent will work in (for grounding, read-only now). */
  worktree?: string | undefined;
  maxTasks?: number;
}

/**
 * The planner is a model call (spec §12): it must answer with checklist
 * lines in the plan.md grammar, each tagged with a task class (spec §13).
 * Plain text in, plain text out — no tool use is needed or wanted.
 */
export function composePlanningPrompt(input: PlanningPromptInput): string {
  const lines = [
    PLANNING_MARKER,
    '',
    `Objective: ${input.objectiveTitle}`,
    ...(input.definitionOfDone === undefined ? [] : [`Definition of done: ${input.definitionOfDone}`]),
    ...(input.worktree === undefined ? [] : [`Repository (read it, do not modify it): ${input.worktree}`]),
    '',
    `Break the objective into 2–${String(input.maxTasks ?? 8)} ordered, independently checkable tasks.`,
    'Do NOT change any files — this is planning only.',
    'Answer with ONLY checklist lines in exactly this format, one per task:',
    '- [ ] **T1** [<class>] <imperative task title>',
    `where <class> is one of: ${TASK_CLASSES.filter((c) => c !== 'verify').join(', ')}.`,
    'Use architect for design decisions, implement for code changes, review for',
    'self-review of finished work, docs for documentation. Task ids are T1, T2, …',
  ];
  if (input.context !== undefined && input.context.trim() !== '') {
    lines.push('', '---', input.context.trimEnd());
  }
  return lines.join('\n') + '\n';
}

export class PlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanningError';
  }
}

/**
 * Pull a plan out of free-form model output: every grammar-valid task line
 * is kept (prose, fences and preamble ignored), statuses reset to pending,
 * duplicate ids rejected. `verify` is daemon-owned and never accepted from
 * the model — verification tasks are inserted by `interleaveVerify`.
 */
export function extractPlanTasks(text: string, maxTasks = 20): PlanTask[] {
  const tasks = parsePlan(text).tasks.map((task) => ({
    ...task,
    status: 'pending' as const,
    taskClass: task.taskClass === 'verify' ? ('implement' as const) : task.taskClass,
  }));
  if (tasks.length === 0) throw new PlanningError('planner output contained no task lines');
  if (tasks.length > maxTasks) throw new PlanningError(`planner produced ${String(tasks.length)} tasks (max ${String(maxTasks)})`);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new PlanningError(`planner output repeats task id ${task.id}`);
    ids.add(task.id);
  }
  return tasks;
}

const NEEDS_VERIFY = new Set(['implement', 'refactor', 'rename']);

/**
 * P3.M3.T2: a `verify` task follows every code-changing task, so a broken
 * build blocks progression right where it broke (spec §12 — verification
 * is first-class, not an afterthought).
 */
export function interleaveVerify(tasks: readonly PlanTask[]): PlanTask[] {
  const out: PlanTask[] = [];
  let n = 0;
  for (const task of tasks) {
    out.push(task);
    if (NEEDS_VERIFY.has(task.taskClass)) {
      n += 1;
      out.push({ id: `V${String(n)}`, title: `Verify ${task.id}: ${task.title}`, status: 'pending', taskClass: 'verify' });
    }
  }
  return out;
}

export function renderPlanMarkdown(title: string, tasks: readonly PlanTask[], note?: string): string {
  const lines = [`# ${title}`, ''];
  if (note !== undefined) lines.push(note, '');
  for (const task of tasks) lines.push(`- [ ] **${task.id}** ${formatTaskText(task)}`);
  return lines.join('\n') + '\n';
}

export interface GeneratePlanOptions {
  adapter: HarnessAdapter;
  agent: AgentConfig;
  prompt: string;
  sessionId: string;
  workdir?: string | undefined;
  permissionPolicy?: CompiledPolicy | undefined;
  model?: string | undefined;
  onEvent?: (event: AeosEvent) => void;
}

export interface GeneratedPlan {
  tasks: PlanTask[];
  /** Raw assistant text (kept next to the proposal for review). */
  text: string;
  usd: number;
}

/** Run one planning session and extract its plan. */
export async function generatePlan(opts: GeneratePlanOptions): Promise<GeneratedPlan> {
  const profile = await opts.adapter.createProfile(opts.agent);
  const handle = opts.adapter.spawn({
    profile,
    sessionId: opts.sessionId,
    objective: opts.prompt,
    ...(opts.workdir === undefined ? {} : { workdir: opts.workdir }),
    ...(opts.permissionPolicy === undefined ? {} : { permissionPolicy: opts.permissionPolicy }),
    ...(opts.model === undefined ? {} : { model: opts.model }),
  });
  const texts: string[] = [];
  let usd = 0;
  let failure: string | undefined;
  for await (const event of handle.events) {
    opts.onEvent?.(event);
    if (event.type === 'item.message' && event.payload.role === 'assistant') texts.push(event.payload.text);
    else if (event.type === 'cost.usage') usd += event.payload.usd;
    else if (event.type === 'session.failed') failure = event.payload.reason;
  }
  if (failure !== undefined) throw new PlanningError(`planning session failed: ${failure}`);
  const text = texts.join('\n');
  return { tasks: extractPlanTasks(text), text, usd };
}
