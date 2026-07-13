import type Database from 'better-sqlite3';

/**
 * Derived-index schema (spec §6). `index.db` holds ONLY data rebuildable from
 * files — bump SCHEMA_VERSION on any DDL change and the next open drops and
 * recreates everything (callers then run `reindex()`); there are no
 * migrations for disposable data.
 */
export const SCHEMA_VERSION = 1;

/** Exactly what M3/M6 need to query without directory walks — nothing speculative. */
const DDL = `
CREATE TABLE IF NOT EXISTS agents (
  workspace_id TEXT NOT NULL,
  id           TEXT NOT NULL,
  name         TEXT NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL,
  state               TEXT NOT NULL,
  provider_session_id TEXT,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_agent ON sessions (agent_id);
`;

/** Static SQL only — no interpolation anywhere near exec(). */
const DROP_ALL = 'DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS agents;';

export function applySchema(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version !== SCHEMA_VERSION) {
    db.exec(DROP_ALL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`); // const number, not user input
  }
  db.exec(DDL);
}
