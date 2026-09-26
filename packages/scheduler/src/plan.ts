import { PlanTaskSchema, TASK_CLASSES, type PlanTask, type TaskClass } from '@aeos/contracts';

/**
 * plan.md grammar (spec §12): one task per line —
 *   `- [<marker>] **<ID>** [<class>] @<agent> <title>`
 * marker: ' ' pending · 'x' completed · '~' in_progress · '!' blocked.
 * `[<class>]` (P3.M1) and `@<agent>` (P3.M5 delegation) are optional; a
 * task without a class is `implement`, and only non-default classes are
 * written back, so pre-P3 plans round-trip byte-identically.
 * The parser is tolerant of human edits (extra spaces, `T1:` instead of
 * bold, case of X) and preserves every non-task line verbatim so a
 * parse→serialize round-trip never destroys hand-written context.
 */
export interface ParsedPlan {
  /** All lines of the document; task lines are references into `tasks`. */
  lines: Array<{ kind: 'text'; raw: string } | { kind: 'task'; taskIndex: number }>;
  tasks: PlanTask[];
}

const MARKER_TO_STATUS: Record<string, PlanTask['status']> = {
  ' ': 'pending',
  '': 'pending',
  x: 'completed',
  X: 'completed',
  '~': 'in_progress',
  '!': 'blocked',
};

const STATUS_TO_MARKER: Record<PlanTask['status'], string> = {
  pending: ' ',
  completed: 'x',
  in_progress: '~',
  blocked: '!',
};

const TASK_LINE_RE = /^\s*-\s*\[([ xX~!]?)\]\s*(?:\*\*([A-Za-z0-9._-]+)\*\*|([A-Za-z0-9._-]+):)\s+(.*\S)\s*$/;

const CLASS_SET = new Set<string>(TASK_CLASSES);

/** Peel an optional `[class]` then `@agent` off a task line's text. */
function splitTaskPrefix(text: string): { taskClass: TaskClass; agent: string | undefined; title: string } {
  let rest = text;
  let taskClass: TaskClass = 'implement';
  const tag = /^\[([a-z_]+)\]\s+(.*)$/.exec(rest);
  if (tag !== null && CLASS_SET.has(tag[1] as string)) {
    taskClass = tag[1] as TaskClass;
    rest = tag[2] as string;
  }
  let agent: string | undefined;
  const at = /^@([a-z0-9][a-z0-9-]{0,63})\s+(.*)$/.exec(rest);
  if (at !== null) {
    agent = at[1];
    rest = at[2] as string;
  }
  return { taskClass, agent, title: rest };
}

/** The text after `**ID** ` for one task (inverse of `splitTaskPrefix`). */
export function formatTaskText(task: PlanTask): string {
  const cls = task.taskClass === 'implement' ? '' : `[${task.taskClass}] `;
  const agent = task.agent === undefined ? '' : `@${task.agent} `;
  return `${cls}${agent}${task.title}`;
}

export function parsePlan(markdown: string): ParsedPlan {
  const plan: ParsedPlan = { lines: [], tasks: [] };
  for (const raw of markdown.split('\n')) {
    const match = TASK_LINE_RE.exec(raw);
    if (!match) {
      plan.lines.push({ kind: 'text', raw });
      continue;
    }
    const [, marker, boldId, colonId, rest] = match;
    const status = MARKER_TO_STATUS[marker ?? ' '] ?? 'pending';
    const { taskClass, agent, title } = splitTaskPrefix(rest as string);
    plan.tasks.push(
      PlanTaskSchema.parse({
        id: (boldId ?? colonId) as string,
        title,
        status,
        taskClass,
        ...(agent === undefined ? {} : { agent }),
      }),
    );
    plan.lines.push({ kind: 'task', taskIndex: plan.tasks.length - 1 });
  }
  return plan;
}

export function serializePlan(plan: ParsedPlan): string {
  return plan.lines
    .map((line) => {
      if (line.kind === 'text') return line.raw;
      const task = plan.tasks[line.taskIndex] as PlanTask;
      return `- [${STATUS_TO_MARKER[task.status]}] **${task.id}** ${formatTaskText(task)}`;
    })
    .join('\n');
}

/** Immutably set one task's status; throws on unknown id. */
export function withTaskStatus(
  plan: ParsedPlan,
  taskId: string,
  status: PlanTask['status'],
): ParsedPlan {
  const index = plan.tasks.findIndex((task) => task.id === taskId);
  if (index === -1) throw new Error(`plan has no task "${taskId}"`);
  const tasks = plan.tasks.map((task, i) => (i === index ? { ...task, status } : task));
  return { lines: plan.lines, tasks };
}
