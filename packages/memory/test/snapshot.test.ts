import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeSnapshot, initMemoryLayout, writeMemoryFile } from '../src/index.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aeos-snap-'));
  await initMemoryLayout(root);
  await writeMemoryFile(root, 'identity/core.md', 'I build TypeScript daemons.\n', {
    title: 'Core',
    hook: 'identity',
  });
  await writeMemoryFile(root, 'preferences/style.md', 'Prefers small files and TDD.\n', {
    title: 'Style',
    hook: 'style prefs',
  });
  await writeMemoryFile(root, 'lessons/sqlite.md', 'WAL mode needs busy_timeout.\n', {
    title: 'SQLite',
    hook: 'db lesson',
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('snapshot composer (T2)', () => {
  it('same inputs → byte-identical snapshot (frozen-injection guarantee)', async () => {
    const a = await composeSnapshot(root, { charBudget: 10_000 });
    const b = await composeSnapshot(root, { charBudget: 10_000 });
    expect(a.text).toBe(b.text);
    expect(a.includedFiles).toEqual(b.includedFiles);
  });

  it('never exceeds the char budget and skips files whole (no truncation)', async () => {
    const tight = await composeSnapshot(root, { charBudget: 700 });
    expect(tight.totalChars).toBeLessThanOrEqual(700);
    for (const skipped of tight.skippedFiles) {
      expect(tight.text).not.toContain(`memory:${skipped}`);
    }
    expect(tight.includedFiles.length + tight.skippedFiles.length).toBe(3);
  });

  it('identity outranks later dirs; relevance reorders only within a dir', async () => {
    await writeMemoryFile(root, 'lessons/aaa-unrelated.md', 'nothing to see here\n', {
      title: 'Unrelated',
      hook: 'noise',
    });
    const snapshot = await composeSnapshot(root, {
      charBudget: 10_000,
      relevance: ['sqlite'],
    });
    const order = snapshot.includedFiles;
    expect(order[0]).toBe('identity/core.md');
    // within lessons/, the relevance hit beats the alphabetically-earlier file
    expect(order.indexOf('lessons/sqlite.md')).toBeLessThan(order.indexOf('lessons/aaa-unrelated.md'));
    // deterministic under relevance too
    const again = await composeSnapshot(root, { charBudget: 10_000, relevance: ['sqlite'] });
    expect(again.text).toBe(snapshot.text);
  });
});
