import { z } from 'zod';
import { ULID_REGEX } from './ids.js';
import { PROTOCOL_VERSION } from './version.js';

/**
 * Base fields shared by every event in the system (spec §6).
 * Concrete events extend this with a literal `type` and a `payload`.
 */
export const EnvelopeBaseSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().regex(ULID_REGEX, 'must be a ULID'),
  ts: z.string().datetime(),
  source: z.string().min(1),
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
});

export type EnvelopeBase = z.infer<typeof EnvelopeBaseSchema>;
