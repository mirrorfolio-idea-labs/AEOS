import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyProposals,
  enqueueProposal,
  initMemoryLayout,
  listProposals,
  readIndex,
  syncIndex,
  writeIndex,
  writeMemoryFile,
} from '../src/index.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aeos-propose-'));
  await initMemoryLayout(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('memory.propose queue + applier (T3)', () => {
  it('write/archive proposals apply in id order and clear the queue', async () => {
    await writeMemoryFile(root, 'lessons/old.md', 'stale\n', { title: 'Old', hook: 'stale' });
    await enqueueProposal(root, {
      id: '01-write',
      op: 'write',
      path: 'lessons/new.md',
      content: 'fresh lesson\n',
      title: 'New',
      hook: 'fresh',
    });
    await enqueueProposal(root, { id: '02-archive', op: 'archive', path: 'lessons/old.md' });

    const results = await applyProposals(root);
    expect(results).toEqual([
      { id: '01-write', status: 'applied' },
      { id: '02-archive', status: 'applied' },
    ]);
    expect(await listProposals(root)).toEqual([]);
    expect(await readFile(path.join(root, 'lessons/new.md'), 'utf8')).toBe('fresh lesson\n');
    expect(await readFile(path.join(root, '.archive/lessons/old.md'), 'utf8')).toBe('stale\n');
  });

  it('a failing proposal stays queued with its error; later proposals still apply', async () => {
    const index = await readIndex(root);
    index.budgets['lessons'] = 5;
    await writeIndex(root, index);
    await enqueueProposal(root, {
      id: '01-too-big',
      op: 'write',
      path: 'lessons/big.md',
      content: 'way over the five char budget',
      title: 'Big',
      hook: 'big',
    });
    await enqueueProposal(root, {
      id: '02-ok',
      op: 'write',
      path: 'identity/me.md',
      content: 'ok\n',
      title: 'Me',
      hook: 'id',
    });

    const results = await applyProposals(root);
    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.error).toContain('budget');
    expect(results[1]).toEqual({ id: '02-ok', status: 'applied' });
    expect((await listProposals(root)).map((p) => p.id)).toEqual(['01-too-big']);
    await expect(readFile(path.join(root, 'lessons/big.md'), 'utf8')).rejects.toThrow();
  });

  it('syncIndex makes MEMORY.md lines always match the on-disk file set', async () => {
    await writeMemoryFile(root, 'knowledge/a.md', 'a\n', { title: 'A', hook: 'a' });
    // stray file written outside the store API
    await writeFile(path.join(root, 'knowledge', 'stray.md'), 'stray\n');
    // and a file that vanished outside the API
    await writeMemoryFile(root, 'knowledge/gone.md', 'g\n', { title: 'Gone', hook: 'g' });
    await rm(path.join(root, 'knowledge', 'gone.md'));

    await syncIndex(root);
    const index = await readIndex(root);
    const paths = index.lines.map((l) => /\]\(([^)]+)\)/.exec(l)?.[1]).sort();
    expect(paths).toEqual(['knowledge/a.md', 'knowledge/stray.md']);
  });
});
