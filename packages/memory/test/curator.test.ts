import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initMemoryLayout,
  isCuratorDue,
  listProposals,
  readIndex,
  runCurator,
  writeIndex,
  type CuratorProposal,
} from '../src/index.js';

let root: string;
let auditHome: string;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-25T12:00:00.000Z');

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aeos-curator-'));
  auditHome = await mkdtemp(path.join(os.tmpdir(), 'aeos-curator-audit-'));
  await initMemoryLayout(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(auditHome, { recursive: true, force: true });
});

/** Seed a memory file with an explicit mtime so aging is deterministic. */
async function seed(relPath: string, content: string, ageMs: number): Promise<void> {
  const abs = path.join(root, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  const past = new Date(NOW.getTime() - ageMs);
  await utimes(abs, past, past);
}

/** Relative path -> content hash for every file under root (recursive). */
async function treeFingerprint(dir: string): Promise<Map<string, string>> {
  const fingerprint = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else {
        const rel = path.relative(dir, abs).split(path.sep).join('/');
        fingerprint.set(
          rel,
          createHash('sha256').update(await readFile(abs)).digest('hex'),
        );
      }
    }
  }
  await walk(dir);
  return fingerprint;
}

function curatorLogLines(): string[] {
  const logPath = path.join(
    auditHome,
    'audit',
    `curator-${NOW.toISOString().slice(0, 10)}.ndjson`,
  );
  return readFileSync(logPath, 'utf8').trimEnd().split('\n');
}

describe('curator scaffold (P2.M4.T1)', () => {
  it('dry-run reports stale files and changes nothing', async () => {
    await seed('research/old.md', 'stale research\n', 40 * DAY);
    await seed('research/new.md', 'fresh research\n', 1 * DAY);
    const before = await treeFingerprint(root);

    const report = await runCurator(root, {
      dryRun: true,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
    });

    const expected: CuratorProposal[] = [
      { op: 'archive', path: 'research/old.md', reason: 'stale' },
    ];
    expect(report.proposals).toEqual(expected);
    expect(await treeFingerprint(root)).toEqual(before);
  });

  it('a fully fresh tree yields zero proposals', async () => {
    await seed('knowledge/a.md', 'a\n', 1 * DAY);
    await seed('lessons/b.md', 'b\n', 2 * DAY);
    const report = await runCurator(root, {
      dryRun: true,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
    });
    expect(report.proposals).toEqual([]);
  });

  it('never proposes archiving identity files or MEMORY.md', async () => {
    await seed('identity/core.md', '# core\n', 400 * DAY);
    const report = await runCurator(root, {
      dryRun: true,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
    });
    expect(report.proposals).toEqual([]);
  });

  it('never scans .archive or .proposals', async () => {
    await seed('.archive/knowledge/dead.md', 'old\n', 400 * DAY);
    await seed('.proposals/pending.yaml', 'op: archive\n', 400 * DAY);
    const report = await runCurator(root, {
      dryRun: true,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
    });
    expect(report.proposals).toEqual([]);
  });

  it('orders stale candidates by mtime ascending, then path ascending', async () => {
    await seed('knowledge/b.md', 'b\n', 35 * DAY);
    await seed('knowledge/a.md', 'a\n', 35 * DAY);
    await seed('todos/t.md', 't\n', 50 * DAY);
    const report = await runCurator(root, {
      dryRun: true,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
    });
    expect(report.proposals).toEqual([
      { op: 'archive', path: 'todos/t.md', reason: 'stale' },
      { op: 'archive', path: 'knowledge/a.md', reason: 'stale' },
      { op: 'archive', path: 'knowledge/b.md', reason: 'stale' },
    ]);
  });

  it('respects a custom staleDays window', async () => {
    await seed('knowledge/k.md', 'k\n', 10 * DAY);
    const report = await runCurator(root, {
      dryRun: true,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
      staleDays: 7,
    });
    expect(report.proposals).toEqual([
      { op: 'archive', path: 'knowledge/k.md', reason: 'stale' },
    ]);
  });

  it('is deterministic across scans of an identical tree', async () => {
    await seed('knowledge/k.md', 'k\n', 35 * DAY);
    await seed('todos/t.md', 't\n', 40 * DAY);
    const a = await runCurator(root, { dryRun: true, now: NOW, auditHome, agentRef: 'ws/agent' });
    const b = await runCurator(root, { dryRun: true, now: NOW, auditHome, agentRef: 'ws/agent' });
    expect(JSON.stringify(a.proposals)).toBe(JSON.stringify(b.proposals));
  });

  it('appends exactly one dryRun line per run to its own audit trail', async () => {
    await seed('research/old.md', 'x\n', 40 * DAY);
    await runCurator(root, { dryRun: true, now: NOW, auditHome, agentRef: 'ws/agent' });
    await runCurator(root, { dryRun: true, now: NOW, auditHome, agentRef: 'ws/agent' });

    const lines = curatorLogLines();
    expect(lines).toHaveLength(2);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed[0]).toMatchObject({
      agentRef: 'ws/agent',
      dryRun: true,
      proposals: [{ op: 'archive', path: 'research/old.md', reason: 'stale' }],
    });
    expect(typeof parsed[0]!['ts']).toBe('string');
  });
});

describe('curator operations via memory.propose (P2.M4.T2)', () => {
  it('apply mode archives stale files through the propose pipeline', async () => {
    await seed('research/old.md', 'stale research\n', 40 * DAY);
    const applied: Array<{ path: string; bytes: number; op: string }> = [];
    const report = await runCurator(root, {
      dryRun: false,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
      onApplied: (event) => applied.push(event),
    });
    expect(report.results?.map((r) => r.status)).toEqual(['applied']);
    expect(applied).toEqual([{ path: 'research/old.md', bytes: 0, op: 'archive' }]);
    await expect(readFile(path.join(root, 'research/old.md'), 'utf8')).rejects.toThrow();
    expect(
      await readFile(path.join(root, '.archive', 'research', 'old.md'), 'utf8'),
    ).toBe('stale research\n');
  });

  it('duplicate detection keeps the lexicographically-first copy', async () => {
    await seed('knowledge/x.md', 'same body\n', 1 * DAY);
    await seed('knowledge/a.md', 'same body\n', 2 * DAY);
    const report = await runCurator(root, {
      dryRun: true,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
    });
    expect(report.proposals).toEqual([
      { op: 'archive', path: 'knowledge/x.md', reason: 'duplicate' },
    ]);
  });

  it('over-budget dirs propose consolidating their two oldest files', async () => {
    const index = await readIndex(root);
    index.budgets['todos'] = 30;
    await writeIndex(root, index);
    await seed('todos/a1.md', 'a'.repeat(20), 10 * DAY);
    await seed('todos/b1.md', 'b'.repeat(20), 5 * DAY);
    const report = await runCurator(root, {
      dryRun: true,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
    });
    expect(report.proposals).toEqual([
      {
        op: 'consolidate',
        paths: ['todos/a1.md', 'todos/b1.md'],
        path: 'todos/a1.curated.md',
        title: 'a1',
        hook: 'curated summary of 2 files',
        reason: 'over-budget',
      },
    ]);
  });

  it('identity is exempt from consolidation', async () => {
    const index = await readIndex(root);
    index.budgets['identity'] = 10;
    await writeIndex(root, index);
    await seed('identity/core.md', '# core\n', 1 * DAY);
    await seed('identity/more.md', 'more\n', 2 * DAY);
    const report = await runCurator(root, {
      dryRun: true,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
    });
    expect(report.proposals).toEqual([]);
  });

  it('apply mode reorganizes a mixed fixture exactly as expected', async () => {
    const index = await readIndex(root);
    index.budgets['lessons'] = 30;
    await writeIndex(root, index);
    await seed('todos/t.md', 'old todo\n', 40 * DAY);
    await seed('knowledge/x.md', 'dup body\n', 1 * DAY);
    await seed('knowledge/a.md', 'dup body\n', 2 * DAY);
    await seed('lessons/l1.md', 'l'.repeat(20), 10 * DAY);
    await seed('lessons/l2.md', 'm'.repeat(20), 5 * DAY);

    await runCurator(root, { dryRun: false, now: NOW, auditHome, agentRef: 'ws/agent' });

    // survivors
    expect(await readFile(path.join(root, 'knowledge/a.md'), 'utf8')).toBe('dup body\n');
    const consolidated = await readFile(path.join(root, 'lessons/l1.curated.md'), 'utf8');
    expect(consolidated).toContain('llll');
    expect(consolidated).toContain('mmmm');
    // archived, never deleted
    expect(
      await readFile(path.join(root, '.archive', 'todos', 't.md'), 'utf8'),
    ).toBe('old todo\n');
    expect(
      await readFile(path.join(root, '.archive', 'knowledge', 'x.md'), 'utf8'),
    ).toBe('dup body\n');
    expect(
      await readFile(path.join(root, '.archive', 'lessons', 'l1.md'), 'utf8'),
    ).toBeDefined();
    expect(
      await readFile(path.join(root, '.archive', 'lessons', 'l2.md'), 'utf8'),
    ).toBeDefined();
    // index reflects the consolidated file
    expect((await readIndex(root)).lines.join('\n')).toContain('l1.curated.md');
  });

  it('a failed application is reported and its queue file retained', async () => {
    const index = await readIndex(root);
    index.budgets['lessons'] = 2;
    await writeIndex(root, index);
    await seed('lessons/s1.md', 'xxx', 10 * DAY);
    await seed('lessons/s2.md', 'yyy', 5 * DAY);

    const report = await runCurator(root, {
      dryRun: false,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
    });
    expect(report.results?.map((r) => r.status)).toEqual(['failed']);
    expect((await listProposals(root))).toHaveLength(1);
  });

  it('a custom summarize function overrides the built-in extractive one', async () => {
    const index = await readIndex(root);
    index.budgets['lessons'] = 30;
    await writeIndex(root, index);
    await seed('lessons/c1.md', 'c'.repeat(20), 10 * DAY);
    await seed('lessons/c2.md', 'd'.repeat(20), 5 * DAY);

    await runCurator(root, {
      dryRun: false,
      now: NOW,
      auditHome,
      agentRef: 'ws/agent',
      summarize: async () => 'CUSTOM SUMMARY',
    });
    expect(await readFile(path.join(root, 'lessons/c1.curated.md'), 'utf8')).toBe(
      'CUSTOM SUMMARY',
    );
  });
});

describe('isCuratorDue (P2.M4.T1)', () => {
  const IDLE_MS = 15 * 60 * 1000;
  const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const now = 1_000_000_000_000;

  it('is due when quiet past the idle window and never run', () => {
    expect(
      isCuratorDue({
        lastActivityMs: now - IDLE_MS - 1,
        lastRunMs: undefined,
        nowMs: now,
        idleMs: IDLE_MS,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it('is not due while activity is inside the idle window', () => {
    expect(
      isCuratorDue({
        lastActivityMs: now - IDLE_MS + 1,
        lastRunMs: undefined,
        nowMs: now,
        idleMs: IDLE_MS,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(false);
  });

  it('is not due before minInterval elapses since the last run', () => {
    expect(
      isCuratorDue({
        lastActivityMs: now - IDLE_MS - 1,
        lastRunMs: now - MIN_INTERVAL_MS + 1,
        nowMs: now,
        idleMs: IDLE_MS,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(false);
  });

  it('is due again once both windows have elapsed', () => {
    expect(
      isCuratorDue({
        lastActivityMs: now - IDLE_MS - 1,
        lastRunMs: now - MIN_INTERVAL_MS - 1,
        nowMs: now,
        idleMs: IDLE_MS,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(true);
  });
});
