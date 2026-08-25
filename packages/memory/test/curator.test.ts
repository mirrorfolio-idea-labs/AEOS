import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initMemoryLayout,
  isCuratorDue,
  runCurator,
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

  it('refuses apply mode until P2.M4.T2 lands it', async () => {
    await expect(
      runCurator(root, { dryRun: false, now: NOW, auditHome, agentRef: 'ws/agent' }),
    ).rejects.toThrow(/T2/);
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
