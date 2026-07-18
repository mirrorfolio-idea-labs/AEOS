import {
  assertSessionTransition,
  newEventId,
  PROTOCOL_VERSION,
  type AeosEvent,
  type SessionRecord,
  type SessionState,
} from '@aeos/contracts';
import {
  indexSession,
  readSessionYaml,
  writeSessionYaml,
  type EventBus,
  type IndexDb,
} from '@aeos/kernel';

export interface TransitionOptions {
  home: string;
  db: IndexDb;
  bus: EventBus;
  workspaceId: string;
  agentId: string;
  sessionId: string;
  to: SessionState;
}

/**
 * THE code path for session state changes (spec §7; ROADMAP M3.T4) — used by
 * the supervisor now and the scheduler later. Every accepted transition is:
 * contracts-validated (`assertSessionTransition`, illegal → typed error with
 * state untouched) → atomic `session.yaml` rewrite (M2 codecs) →
 * `session.state_changed` on the bus → index upsert. Returns the new record.
 */
export function transitionSession(options: TransitionOptions): SessionRecord {
  const { home, db, bus, workspaceId, agentId, sessionId, to } = options;
  const record = readSessionYaml(home, workspaceId, agentId, sessionId);
  assertSessionTransition(record.state, to);

  const next: SessionRecord = { ...record, state: to };
  writeSessionYaml(home, workspaceId, agentId, sessionId, next);
  bus.publish({
    v: PROTOCOL_VERSION,
    id: newEventId(),
    ts: new Date().toISOString(),
    source: 'supervisor',
    agentId,
    sessionId,
    type: 'session.state_changed',
    payload: { from: record.state, to },
  } as AeosEvent);
  indexSession(db, next, Date.now());
  return next;
}
