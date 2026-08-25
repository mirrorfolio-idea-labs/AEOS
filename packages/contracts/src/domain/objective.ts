import { z } from 'zod';

export const ObjectiveSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().min(1),
  definitionOfDone: z.string().optional(),
  budgetUsd: z.number().positive().optional(),
  budgetTokens: z.number().int().positive().optional(),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const PlanTaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'blocked']);

export const PlanTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: PlanTaskStatusSchema,
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
  summary: z.string().min(1),
  costs: z.object({ usd: z.number().nonnegative(), tokens: z.number().int().nonnegative() }),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
