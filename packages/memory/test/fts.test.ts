import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openIndexDb, type IndexDb } from '@aeos/kernel';
import {
  archiveMemoryFile,
  initMemoryLayout,
  rebuildMemoryFts,
  searchMemory,
  updateMemoryFts,
  writeMemoryFile,
} from '../src/index.js';

let root: string;
let home: string;
let db: IndexDb;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aeos-fts-mem-'));
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-fts-home-'));
  db = openIndexDb(home);
  await initMemoryLayout(root);
  await writeMemoryFile(root, 'lessons/sqlite.md', 'WAL mode needs a busy timeout.\n', {
    title: 'SQLite',
    hook: 'db',
  });
  await writeMemoryFile(root, 'preferences/style.md', 'Small files, strict TypeScript.\n', {
    title: 'Style',
    hook: 'style',
  });
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

const dump = (d: IndexDb) =>
  d
    .prepare('SELECT agent_id, path, body FROM memory_fts ORDER BY path')
    .all() as Array<Record<string, unknown>>;

describe('memory FTS (T4)', () => {
  it('search finds memory by content with a snippet', async () => {
    await rebuildMemoryFts(db, 'agent-1', root);
    const hits = searchMemory(db, 'agent-1', 'busy timeout', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('lessons/sqlite.md');
    expect(hits[0]?.snippet).toContain('[busy]');
  });

  it('rebuild-from-scratch equals incremental index results (accept)', async () => {
    await rebuildMemoryFts(db, 'agent-1', root);
    // incremental path: new write + archive, updated one file at a time
    await writeMemoryFile(root, 'lessons/pnpm.md', 'workspace protocol pins versions\n', {
      title: 'pnpm',
      hook: 'pnpm',
    });
    await updateMemoryFts(db, 'agent-1', root, 'lessons/pnpm.md');
    await archiveMemoryFile(root, 'preferences/style.md');
    await updateMemoryFts(db, 'agent-1', root, 'preferences/style.md');
    const incremental = dump(db);

    // scratch path: fresh db, full rebuild from the same files
    const home2 = await mkdtemp(path.join(os.tmpdir(), 'aeos-fts-home2-'));
    const db2 = openIndexDb(home2);
    await rebuildMemoryFts(db2, 'agent-1', root);
    const scratch = dump(db2);
    db2.close();
    await rm(home2, { recursive: true, force: true });

    expect(incremental).toEqual(scratch);
  });

  it('agents are isolated in the shared table', async () => {
    await rebuildMemoryFts(db, 'agent-1', root);
    await rebuildMemoryFts(db, 'agent-2', root);
    expect(searchMemory(db, 'agent-2', 'TypeScript', 5)).toHaveLength(1);
    db.prepare('DELETE FROM memory_fts WHERE agent_id = ?').run('agent-2');
    expect(searchMemory(db, 'agent-2', 'TypeScript', 5)).toHaveLength(0);
    expect(searchMemory(db, 'agent-1', 'TypeScript', 5)).toHaveLength(1);
  });
});
