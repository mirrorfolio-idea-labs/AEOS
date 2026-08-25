import { mkdtemp, readdir, readFile, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initMemoryLayout,
  readIndex,
  runCurator,
  scanMemory,
  writeIndex,
  CuratorPathError,
} from '../src/index.js';

let root: string;
let auditHome: string;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-25T12:00:00.000Z');
const NEXT_DAY = new Date('2026-08-26T09:00:00.000Z');

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aeos-curator-g-'));
  auditHome = await mkdtemp(path.join(os.tmpdir(), 'aeos-curator-g-audit-'));
  await initMemoryLayout(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(auditHome, { recursive: true, force: true });
});

async function seed(relPath: string, content: string, ageMs: number): Promise<void> {
  const abs = path.join(root, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  const past = new Date(NOW.getTime() - ageMs);
  await utimes(abs, past, past);
}

/** rel path -> content for every file under root, any depth. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else {
        files.set(path.relative(dir, abs).split(path.sep).join('/'), await readFile(abs, 'utf8'));
      }
    }
  }
  await walk(dir);
  return files;
}

/** A fixture exercising every proposal kind at once. */
async function seedMixedFixture(): Promise<void> {
  const index = await readIndex(root);
  index.budgets['todos'] = 30;
  await writeIndex(root, index);
  await seed('todos/a1.md', 'a'.repeat(20), 10 * DAY); // over-budget pair (oldest)
  await seed('todos/b1.md', 'b'.repeat(20), 5 * DAY);
  await seed('knowledge/x.md', 'dup body\n', 40 * DAY); // duplicate AND stale
  await seed('knowledge/a.md', 'dup body\n', 2 * DAY); // lexicographic keeper
  await seed('research/r.md', 'stale research\n', 45 * DAY); // plain stale
}

describe('curator never-delete guarantee (P2.M4.T3)', () => {
  it('every pre-run byte survives an apply-mode run', async () => {
    await seedMixedFixture();
    const before = await snapshot(root);

    await runCurator(root, { dryRun: false, now: NOW, auditHome, agentRef: 'ws/agent' });

    const after = await snapshot(root);
    // MEMORY.md is the derived index (rebuilt by design) — the guarantee
    // covers memory CONTENT, not the rebuildable view.
    before.delete('MEMORY.md');
    const afterCounts = new Map<string, number>();
    for (const content of after.values()) {
      afterCounts.set(content, (afterCounts.get(content) ?? 0) + 1);
    }
    for (const [relPath, content] of before) {
      const remaining = afterCounts.get(content) ?? 0;
      expect(remaining, `${relPath} content must remain somewhere under the tree`).toBeGreaterThan(0);
      afterCounts.set(content, remaining - 1);
    }
    // and the reorganization actually happened
    expect(after.has('.archive/todos/a1.md')).toBe(true);
    expect(after.has('.archive/knowledge/x.md')).toBe(true);
    expect(await readFile(path.join(root, 'todos/a1.curated.md'), 'utf8')).toBeDefined();
  });

  it('emits only archive/consolidate proposals — no deletion op exists', async () => {
    await seedMixedFixture();
    const proposals = await scanMemory(root, { now: NOW });
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      expect(['archive', 'consolidate']).toContain(proposal.op);
      if (proposal.op === 'consolidate') {
        expect(proposal.paths).toHaveLength(2);
        expect(typeof proposal.title).toBe('string');
        expect(typeof proposal.hook).toBe('string');
      }
    }
  });

  it('keeps its own trail append-only and split by UTC date', async () => {
    await seed('research/old.md', 'x\n', 40 * DAY);
    const logFor = (date: string): string =>
      path.join(auditHome, 'audit', `curator-${date}.ndjson`);

    await runCurator(root, { dryRun: true, now: NOW, auditHome, agentRef: 'ws/agent' });
    const day1First = await readFile(logFor('2026-08-25'), 'utf8');
    await runCurator(root, { dryRun: true, now: NOW, auditHome, agentRef: 'ws/agent' });
    const day1Both = await readFile(logFor('2026-08-25'), 'utf8');
    expect(day1Both.startsWith(day1First)).toBe(true); // strictly append-only
    expect(day1Both.trimEnd().split('\n')).toHaveLength(2);

    await runCurator(root, { dryRun: false, now: NEXT_DAY, auditHome, agentRef: 'ws/agent' });
    const day2 = await readFile(logFor('2026-08-26'), 'utf8');
    expect(day2.trimEnd().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(day2) as { dryRun: boolean; results?: unknown[] };
    expect(parsed.dryRun).toBe(false);
    expect(parsed.results).toHaveLength(1);
  });

  it('refuses non-normalized or relative roots with a typed error', async () => {
    await expect(
      runCurator('relative/memory', { dryRun: true, now: NOW, auditHome, agentRef: 'ws/agent' }),
    ).rejects.toThrow(CuratorPathError);
    await expect(
      runCurator(`${root}/../escaped`, {
        dryRun: true,
        now: NOW,
        auditHome,
        agentRef: 'ws/agent',
      }),
    ).rejects.toThrow(/normalized/);
    // a clean absolute root is accepted
    await expect(
      runCurator(root, { dryRun: true, now: NOW, auditHome, agentRef: 'ws/agent' }),
    ).resolves.toBeDefined();
  });
});
