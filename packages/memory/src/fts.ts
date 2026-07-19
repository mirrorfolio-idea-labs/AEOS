import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndexDb } from '@aeos/kernel';
import { MEMORY_DIRS } from './layout.js';

/**
 * Derived FTS5 index over memory files (spec §8 rule 3). Lives in the
 * kernel's index.db but owns its table: rebuildable from files at any
 * time, so kernel schema resets are harmless.
 */
export function ensureMemoryFts(db: IndexDb): void {
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
       agent_id UNINDEXED, path UNINDEXED, body
     )`,
  );
}

export interface MemorySearchHit {
  agentId: string;
  path: string;
  snippet: string;
}

async function memoryFiles(root: string): Promise<Array<{ relPath: string; body: string }>> {
  const files: Array<{ relPath: string; body: string }> = [];
  for (const dir of MEMORY_DIRS) {
    let entries: string[];
    try {
      entries = (await readdir(path.join(root, dir))).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      try {
        files.push({
          relPath: `${dir}/${entry}`,
          body: await readFile(path.join(root, dir, entry), 'utf8'),
        });
      } catch {
        // subdirectories are not indexed in v0
      }
    }
  }
  return files;
}

/** Full rebuild for one agent's memory tree — the reindex path. */
export async function rebuildMemoryFts(db: IndexDb, agentId: string, root: string): Promise<number> {
  ensureMemoryFts(db);
  const files = await memoryFiles(root);
  const insert = db.prepare('INSERT INTO memory_fts (agent_id, path, body) VALUES (?, ?, ?)');
  const run = db.transaction(() => {
    db.prepare('DELETE FROM memory_fts WHERE agent_id = ?').run(agentId);
    for (const file of files) insert.run(agentId, file.relPath, file.body);
  });
  run();
  return files.length;
}

/** Incremental update for a single memory file (pass null body for deletions/archives). */
export async function updateMemoryFts(
  db: IndexDb,
  agentId: string,
  root: string,
  relPath: string,
): Promise<void> {
  ensureMemoryFts(db);
  let body: string | null = null;
  try {
    body = await readFile(path.join(root, relPath), 'utf8');
  } catch {
    body = null;
  }
  const run = db.transaction(() => {
    db.prepare('DELETE FROM memory_fts WHERE agent_id = ? AND path = ?').run(agentId, relPath);
    if (body !== null) {
      db.prepare('INSERT INTO memory_fts (agent_id, path, body) VALUES (?, ?, ?)').run(
        agentId,
        relPath,
        body,
      );
    }
  });
  run();
}

/** `memory.search(query, k)` (spec §8) — snippet-highlighted FTS5 match. */
export function searchMemory(
  db: IndexDb,
  agentId: string,
  query: string,
  k: number,
): MemorySearchHit[] {
  ensureMemoryFts(db);
  const rows = db
    .prepare(
      `SELECT agent_id AS agentId, path,
              snippet(memory_fts, 2, '[', ']', '…', 12) AS snippet
       FROM memory_fts
       WHERE agent_id = ? AND memory_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(agentId, query, k);
  return rows as MemorySearchHit[];
}
