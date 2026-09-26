import { z } from 'zod';

export const ObjectiveSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().min(1),
  definitionOfDone: z.string().optional(),
  /** Repo binding id (AgentConfig.repos) — the objective runs in its own worktree of it. */
  repo: z.string().optional(),
  budgetUsd: z.number().positive().optional(),
  budgetTokens: z.number().int().positive().optional(),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const PlanTaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'blocked']);

/**
 * Task classes (spec §13) set by the planner; the router maps each class to
 * (provider, model, thinking). `verify` is the first-class verification
 * task type (spec §12, P3.M3) — run by the daemon, not a harness session.
 */
export const TASK_CLASSES = [
  'plan',
  'architect',
  'implement',
  'refactor',
  'review',
  'security_review',
  'summarize',
  'docs',
  'rename',
  'verify',
] as const;
export const TaskClassSchema = z.enum(TASK_CLASSES);
export type TaskClass = z.infer<typeof TaskClassSchema>;

export const PlanTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: PlanTaskStatusSchema,
  /** Plans written before P3.M1 carry no class — they parse as `implement`. */
  taskClass: TaskClassSchema.default('implement'),
  /** Delegation (P3.M5): another agent in the same workspace runs this task. */
  agent: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
});
export type PlanTask = z.infer<typeof PlanTaskSchema>;

/** Shape of objectives/<id>/checkpoints/<task>.yaml (spec §12). */
export const CheckpointSchema = z.object({
  taskId: z.string().min(1),
  status: PlanTaskStatusSchema,
  /** 3-strike counter (spec §12) — persisted so backoff survives restarts. */
  attempts: z.number().int().nonnegative().default(0),
  commit: z.string().optional(),
  providerResumeToken: z.string().optional(),
  /** Verification outcome for `verify` tasks (P3.M3). */
  verification: z
    .object({
      outcome: z.enum(['pass', 'fail', 'flaky']),
      commands: z.array(
        z.object({
          command: z.string(),
          exitCode: z.number().int(),
          attempts: z.number().int().positive(),
          outputTail: z.string(),
        }),
      ),
    })
    .optional(),
  summary: z.string().min(1),
  costs: z.object({ usd: z.number().nonnegative(), tokens: z.number().int().nonnegative() }),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
