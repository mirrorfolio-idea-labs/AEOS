import { z } from 'zod';
import { EnvelopeBaseSchema } from '../envelope.js';
import { SessionStateSchema } from '../domain/session.js';

const ev = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  EnvelopeBaseSchema.extend({ type: z.literal(type), payload });

const empty = z.object({}).strict();

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
]);

export type AeosEvent = z.infer<typeof AeosEventSchema>;

export const AEOS_EVENT_TYPES = AeosEventSchema.options.map(
  (o) => o.shape.type.value,
) as readonly string[];
