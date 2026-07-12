import { z } from 'zod';
import { ULID_REGEX } from '../ids.js';

export const SESSION_STATES = [
  'created', 'starting', 'running', 'waiting_approval',
  'paused', 'completed', 'failed', 'orphaned',
] as const;

export const SessionStateSchema = z.enum(SESSION_STATES);
export type SessionState = z.infer<typeof SessionStateSchema>;

const TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  created: ['starting', 'failed'],
  starting: ['running', 'failed'],
  running: ['waiting_approval', 'paused', 'completed', 'failed', 'orphaned'],
  waiting_approval: ['running', 'failed', 'orphaned'],
  paused: ['running', 'failed', 'orphaned'],
  completed: [],
  failed: [],
  orphaned: ['running', 'failed'], // re-adoption path (spec §10)
};

export class InvalidTransitionError extends Error {
  constructor(from: SessionState, to: SessionState) {
    super(`invalid session transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertSessionTransition(from: SessionState, to: SessionState): void {
  if (!TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);
}

/** Shape of sessions/<id>/session.yaml (spec §7). */
export const SessionRecordSchema = z.object({
  id: z.string().regex(ULID_REGEX),
  agentId: z.string().min(1),
  objectiveId: z.string().min(1).optional(),
  state: SessionStateSchema,
  providerSessionId: z.string().optional(),
  runnerPid: z.number().int().positive().optional(),
  runnerSocket: z.string().optional(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
