import { z } from 'zod';
import { EnvelopeBaseSchema } from '../envelope.js';
import { SessionStateSchema } from '../domain/session.js';
import { TierSchema } from '../domain/policy.js';

const ev = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  EnvelopeBaseSchema.extend({ type: z.literal(type), payload });

const empty = z.object({}).strict();

/**
 * Attention-level agent status (P2.M10, idea from herdr): `working` while a
 * session makes progress, `blocked` when it needs a human (approval, budget
 * stop, a permission prompt on screen), `done` when the last session ended,
 * `idle` when nothing has run, `unknown` when a screen cannot be classified.
 */
export const AgentStatusSchema = z.enum(['idle', 'working', 'blocked', 'done', 'unknown']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AeosEventSchema = z.discriminatedUnion('type', [
  ev('session.created', empty),
  ev('session.state_changed', z.object({ from: SessionStateSchema, to: SessionStateSchema })),
  ev('session.completed', empty),
  ev('session.failed', z.object({ reason: z.string() })),
  ev('session.orphaned', empty),
  ev('turn.started', z.object({ turn: z.number().int().positive() })),
  ev('turn.completed', z.object({ turn: z.number().int().positive() })),
  ev('turn.failed', z.object({ turn: z.number().int().positive(), reason: z.string() })),
  ev('item.message', z.object({ role: z.enum(['assistant', 'user', 'system']), text: z.string() })),
  ev('item.tool_call', z.object({ callId: z.string(), tool: z.string(), input: z.unknown() })),
  ev('item.tool_result', z.object({ callId: z.string(), ok: z.boolean(), output: z.string() })),
  ev('item.file_change', z.object({ path: z.string(), kind: z.enum(['created', 'modified', 'deleted']) })),
  ev('cost.usage', z.object({
    profileId: z.string(),
    usd: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
  })),
  ev('approval.request', z.object({
    requestId: z.string(),
    action: z.string(),
    detail: z.string(),
    expiresAt: z.string().datetime(),
  })),
  ev(
    'approval.resolved',
    z.object({
      requestId: z.string(),
      decision: z.enum(['approved', 'denied', 'expired']),
      by: z.string(),
    }),
  ),
  ev('policy.blocked', z.object({ tier: TierSchema, tool: z.string(), detail: z.string() })),
  ev(
    'budget.exceeded',
    z.object({
      scope: z.literal('objective'),
      id: z.string(),
      kind: z.enum(['usd', 'tokens']),
      cap: z.number().positive(),
      spent: z.number().nonnegative(),
    }),
  ),
  ev('memory.written', z.object({ path: z.string(), bytes: z.number().int().nonnegative() })),
  ev(
    'agent.status_changed',
    z.object({
      workspaceId: z.string(),
      status: AgentStatusSchema,
      previous: AgentStatusSchema,
      /** Monotonic per agent — inbox "unseen" compares against it. */
      seq: z.number().int().positive(),
      /** `events` = derived from the canonical stream; `screen` = PTY screen rules. */
      via: z.enum(['events', 'screen']),
      reason: z.string().optional(),
      /** Screen rule id that matched (for `aeos agent explain`-style debugging). */
      rule: z.string().optional(),
    }),
  ),
]);

export type AeosEvent = z.infer<typeof AeosEventSchema>;

export const AEOS_EVENT_TYPES = AeosEventSchema.options.map(
  (o) => o.shape.type.value,
) as readonly string[];
