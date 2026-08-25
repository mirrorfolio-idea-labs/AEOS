import { AeosEventSchema, PROTOCOL_VERSION } from '@aeos/contracts';
import { z } from 'zod';

/**
 * Daemon↔runner wire messages (internal protocol — both ends live in this
 * repo, so the schemas live here; the version constant is contracts-owned).
 * Session/user-visible events stay on the canonical taxonomy: an `event`
 * message carries a full `AeosEvent`, never a private shape.
 */

const seq = z.number().int().nonnegative();

export const HelloSchema = z.object({
  t: z.literal('hello'),
  v: z.number().int().positive(),
  minV: z.number().int().positive(),
  maxV: z.number().int().positive(),
  sessionId: z.string().min(1),
}).strict();

export const HelloAckSchema = z.object({
  t: z.literal('helloAck'),
  v: z.number().int().positive(),
  lastSeq: seq,
}).strict();

export const EventMessageSchema = z.object({
  t: z.literal('event'),
  seq,
  event: AeosEventSchema,
}).strict();

export const HeartbeatSchema = z.object({
  t: z.literal('heartbeat'),
  seq: seq.optional(),
}).strict();

export const ReplaySchema = z.object({
  t: z.literal('replay'),
  fromSeq: seq,
}).strict();

export const StopSchema = z.object({
  t: z.literal('stop'),
  reason: z.string().min(1),
}).strict();

export const ProtoErrorSchema = z.object({
  t: z.literal('protoError'),
  code: z.string().min(1),
  message: z.string(),
}).strict();

// ── PTY takeover messages (additive, P2.M5): a runner only emits these after
// receiving `ptyOpen`, so mixed-version pairs never exchange unknown types.

const dims = z.number().int().positive();

export const PtyOpenSchema = z.object({
  t: z.literal('ptyOpen'),
  cols: dims,
  rows: dims,
}).strict();

export const PtyStartedSchema = z.object({
  t: z.literal('ptyStarted'),
  cols: dims,
  rows: dims,
}).strict();

export const PtyInputSchema = z.object({
  t: z.literal('ptyInput'),
  data: z.string().max(8192),
}).strict();

export const PtyResizeSchema = z.object({
  t: z.literal('ptyResize'),
  cols: dims,
  rows: dims,
}).strict();

export const PtyOutputSchema = z.object({
  t: z.literal('ptyOutput'),
  data: z.string().max(65536),
}).strict();

export const PtyCloseSchema = z.object({
  t: z.literal('ptyClose'),
}).strict();

export const PtyClosedSchema = z.object({
  t: z.literal('ptyClosed'),
  exitCode: z.number().int(),
}).strict();

export const WireMessageSchema = z.discriminatedUnion('t', [
  HelloSchema,
  HelloAckSchema,
  EventMessageSchema,
  HeartbeatSchema,
  ReplaySchema,
  StopSchema,
  ProtoErrorSchema,
  PtyOpenSchema,
  PtyStartedSchema,
  PtyInputSchema,
  PtyResizeSchema,
  PtyOutputSchema,
  PtyCloseSchema,
  PtyClosedSchema,
]);

export type WireMessage = z.infer<typeof WireMessageSchema>;
export type Hello = z.infer<typeof HelloSchema>;
export type HelloAck = z.infer<typeof HelloAckSchema>;
export type EventMessage = z.infer<typeof EventMessageSchema>;
export type PtyWireMessage = z.infer<
  typeof PtyStartedSchema | typeof PtyOutputSchema | typeof PtyClosedSchema
>;

/** The version range this build of the runner/daemon speaks. */
export const SUPPORTED_VERSIONS = { minV: PROTOCOL_VERSION, maxV: PROTOCOL_VERSION } as const;

export class VersionMismatchError extends Error {
  constructor(a: VersionRange, b: VersionRange) {
    super(
      `no protocol version overlap: [${a.minV},${a.maxV}] vs [${b.minV},${b.maxV}]`,
    );
    this.name = 'VersionMismatchError';
  }
}

export interface VersionRange {
  minV: number;
  maxV: number;
}

/** Highest mutually supported version, or VersionMismatchError. */
export function negotiateVersion(a: VersionRange, b: VersionRange): number {
  const low = Math.max(a.minV, b.minV);
  const high = Math.min(a.maxV, b.maxV);
  if (low > high) throw new VersionMismatchError(a, b);
  return high;
}

/** Parse a decoded frame into a typed wire message; throws on anything else. */
export function parseWireMessage(raw: unknown): WireMessage {
  const result = WireMessageSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`invalid wire message: ${result.error.message}`);
  }
  return result.data;
}
