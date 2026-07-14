import fs from 'node:fs';
import type { AeosEvent } from '@aeos/contracts';
import { sessionDir, transcriptPath } from '../home/paths.js';
import type { IndexDb } from '../index-db/db.js';
import type { EventBus } from './bus.js';

/** Thrown when an event names a session the index cannot place on disk. */
export class TranscriptRoutingError extends Error {
  constructor(sessionId: string) {
    super(`cannot resolve session '${sessionId}' to a workspace/agent directory`);
    this.name = 'TranscriptRoutingError';
  }
}

interface SessionLocation {
  workspaceId: string;
  agentId: string;
}

/**
 * Resolves a session to its on-disk owner via the derived index
 * (sessions → agent_id → agents → workspace_id). Spec §7: routing keys on the
 * AEOS session ULID, never on provider ids.
 */
function locateSession(db: IndexDb, sessionId: string): SessionLocation | undefined {
  return db
    .prepare(
      `SELECT a.workspace_id AS workspaceId, a.id AS agentId
       FROM sessions s JOIN agents a ON a.id = s.agent_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as SessionLocation | undefined;
}

/**
 * Subscribes a writer that appends every event carrying a `sessionId` to that
 * session's `transcript.ndjson` (spec §6). Writes are synchronous appends —
 * publish order is transcript order. Returns the unsubscribe function.
 */
export function attachTranscriptWriter(bus: EventBus, home: string, db: IndexDb): () => void {
  return bus.subscribe({}, (event: AeosEvent) => {
    const sessionId = event.sessionId;
    if (sessionId === undefined) return;
    const loc = locateSession(db, sessionId);
    if (loc === undefined) throw new TranscriptRoutingError(sessionId); // → bus onHandlerError
    fs.mkdirSync(sessionDir(home, loc.workspaceId, loc.agentId, sessionId), { recursive: true });
    fs.appendFileSync(
      transcriptPath(home, loc.workspaceId, loc.agentId, sessionId),
      `${JSON.stringify(event)}\n`,
    );
  });
}
