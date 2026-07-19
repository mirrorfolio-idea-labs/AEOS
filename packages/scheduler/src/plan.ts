import { PlanTaskSchema, type PlanTask } from '@aeos/contracts';

/**
 * plan.md grammar (spec §12): one task per line —
 *   `- [<marker>] **<ID>** <title>`
 * marker: ' ' pending · 'x' completed · '~' in_progress · '!' blocked.
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

export function parsePlan(markdown: string): ParsedPlan {
  const plan: ParsedPlan = { lines: [], tasks: [] };
  for (const raw of markdown.split('\n')) {
    const match = TASK_LINE_RE.exec(raw);
    if (!match) {
      plan.lines.push({ kind: 'text', raw });
      continue;
    }
    const [, marker, boldId, colonId, title] = match;
    const status = MARKER_TO_STATUS[marker ?? ' '] ?? 'pending';
    plan.tasks.push(
      PlanTaskSchema.parse({ id: (boldId ?? colonId) as string, title: title as string, status }),
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
      return `- [${STATUS_TO_MARKER[task.status]}] **${task.id}** ${task.title}`;
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
