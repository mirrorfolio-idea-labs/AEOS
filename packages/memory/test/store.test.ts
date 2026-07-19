import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  archiveMemoryFile,
  consolidateMemoryFiles,
  initMemoryLayout,
  OverBudgetError,
  readIndex,
  UnknownMemoryDirError,
  writeIndex,
  writeMemoryFile,
} from '../src/index.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aeos-memory-'));
  await initMemoryLayout(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('memory store (T1)', () => {
  it('initMemoryLayout creates the spec §8 tree with a budgeted MEMORY.md', async () => {
    for (const dir of ['identity', 'lessons', '.archive', '.proposals']) {
      expect((await stat(path.join(root, dir))).isDirectory()).toBe(true);
    }
    const index = await readIndex(root);
    expect(index.budgets['identity']).toBeGreaterThan(0);
    expect(index.lines).toEqual([]);
  });

  it('writes within budget and records an index line', async () => {
    await writeMemoryFile(root, 'identity/core.md', '# I am the smoke agent\n', {
      title: 'Core identity',
      hook: 'who this agent is',
    });
    expect(await readFile(path.join(root, 'identity/core.md'), 'utf8')).toContain('smoke agent');
    const index = await readIndex(root);
    expect(index.lines).toEqual(['- [Core identity](identity/core.md) — who this agent is']);
  });

  it('over-budget write returns a typed error and writes NOTHING', async () => {
    const index = await readIndex(root);
    index.budgets['identity'] = 10;
    await writeIndex(root, index);
    await expect(
      writeMemoryFile(root, 'identity/core.md', 'x'.repeat(11), { title: 't', hook: 'h' }),
    ).rejects.toThrow(OverBudgetError);
    await expect(readFile(path.join(root, 'identity/core.md'), 'utf8')).rejects.toThrow();
    expect((await readIndex(root)).lines).toEqual([]);
  });

  it('rejects writes outside the known memory dirs', async () => {
    await expect(
      writeMemoryFile(root, 'secrets/creds.md', 'nope', { title: 't', hook: 'h' }),
    ).rejects.toThrow(UnknownMemoryDirError);
  });

  it('archive preserves content byte-for-byte and drops the index line', async () => {
    await writeMemoryFile(root, 'lessons/one.md', 'lesson body\n', { title: 'One', hook: 'l1' });
    const archived = await archiveMemoryFile(root, 'lessons/one.md');
    expect(archived).toBe(path.join('.archive', 'lessons', 'one.md'));
    expect(await readFile(path.join(root, archived), 'utf8')).toBe('lesson body\n');
    await expect(readFile(path.join(root, 'lessons/one.md'), 'utf8')).rejects.toThrow();
    expect((await readIndex(root)).lines).toEqual([]);
  });

  it('consolidate archives the originals and frees budget for the merged file', async () => {
    const index = await readIndex(root);
    index.budgets['lessons'] = 30;
    await writeIndex(root, index);
    await writeMemoryFile(root, 'lessons/a.md', 'aaaaaaaaaa', { title: 'A', hook: 'a' });
    await writeMemoryFile(root, 'lessons/b.md', 'bbbbbbbbbb', { title: 'B', hook: 'b' });
    // 20/30 used — a 15-char write would exceed, but consolidation replaces both
    await consolidateMemoryFiles(root, ['lessons/a.md', 'lessons/b.md'], 'lessons/ab.md', 'merged 15 chars', {
      title: 'AB',
      hook: 'merged',
    });
    expect(await readFile(path.join(root, 'lessons/ab.md'), 'utf8')).toBe('merged 15 chars');
    expect(await readFile(path.join(root, '.archive/lessons/a.md'), 'utf8')).toBe('aaaaaaaaaa');
    expect((await readIndex(root)).lines).toEqual(['- [AB](lessons/ab.md) — merged']);
  });
});
