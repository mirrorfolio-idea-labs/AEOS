import Database from 'better-sqlite3';
import { indexDbPath } from '../home/paths.js';
import { applySchema } from './schema.js';

export type IndexDb = Database.Database;

/**
 * Opens (or creates) `$AEOS_HOME/index.db` in WAL mode. Deleting this file is
 * always safe; a schema-version mismatch drops all tables (see schema.ts) —
 * callers detect emptiness or simply run `reindex()` after open.
 */
export function openIndexDb(home: string): IndexDb {
  const db = new Database(indexDbPath(home));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  applySchema(db);
  return db;
}
