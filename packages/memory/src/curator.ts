import fs from 'node:fs';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { MEMORY_DIRS } from './layout.js';

/**
 * Memory curator (spec §8 rule 4, ROADMAP P2.M4): an idle-triggered job that
 * ages, deduplicates, and summarizes memory — archiving, never deleting —
 * and applies every change through the `memory.propose` pipeline. v0.2
 * operations are deterministic by design: the milestone exit gate requires a
 * deterministic run, so model-backed summarization stays behind a pluggable
 * seam until the P3 router exists.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type CuratorProposal =
  | { op: 'archive'; path: string; reason: 'stale' };

export interface CuratorRunReport {
  agentRef: string;
  ts: string;
  dryRun: boolean;
  proposals: CuratorProposal[];
}

export interface ScanMemoryOptions {
  now: Date;
  /** Files untouched longer than this are stale (default 30 days). */
  staleDays?: number;
}

interface StaleCandidate {
  relPath: string;
  mtimeMs: number;
}

/**
 * Deterministic scan of the memory tree. Candidates are sorted by mtime
 * ascending, then path ascending — a total order, so identical trees always
 * yield identical proposal lists. `identity/` is stable per spec §8 and is
 * never a candidate; `.archive/`/`.proposals/` are never scanned.
 */
export async function scanMemory(
  root: string,
  options: ScanMemoryOptions,
): Promise<CuratorProposal[]> {
  const staleDays = options.staleDays ?? 30;
  const cutoff = options.now.getTime() - staleDays * DAY_MS;
  const candidates: StaleCandidate[] = [];
  for (const dir of MEMORY_DIRS) {
    if (dir === 'identity') continue;
    const absDir = path.join(root, dir);
    let entries: string[];
    try {
      entries = await readdir(absDir);
    } catch {
      continue; // missing dirs contribute no files
    }
    for (const entry of entries) {
      const relPath = `${dir}/${entry}`;
      const info = await stat(path.join(root, relPath));
      if (!info.isFile()) continue;
      if (info.mtimeMs <= cutoff) candidates.push({ relPath, mtimeMs: info.mtimeMs });
    }
  }
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs || a.relPath.localeCompare(b.relPath));
  return candidates.map((candidate) => ({
    op: 'archive',
    path: candidate.relPath,
    reason: 'stale',
  }));
}

export interface IsCuratorDueInput {
  lastActivityMs: number;
  lastRunMs: number | undefined;
  nowMs: number;
  idleMs: number;
  minIntervalMs: number;
}

/** Pure idle-trigger eligibility: quiet past `idleMs` AND outside the
 * backoff window since the previous run (if any). */
export function isCuratorDue(input: IsCuratorDueInput): boolean {
  if (input.nowMs - input.lastActivityMs < input.idleMs) return false;
  if (
    input.lastRunMs !== undefined &&
    input.nowMs - input.lastRunMs < input.minIntervalMs
  ) {
    return false;
  }
  return true;
}

export interface RunCuratorOptions {
  dryRun: boolean;
  now: Date;
  /** Daemon home owning `audit/` — the curator writes its own trail there. */
  auditHome: string;
  agentRef: string;
  staleDays?: number;
}

/**
 * One curator pass over the memory tree at `root`. Every run — including
 * dry-runs — appends one NDJSON line to `<auditHome>/audit/curator-<utc-date>.ndjson`
 * (append-only, own trail per spec §8.4). Dry-run mutates nothing else.
 */
export async function runCurator(
  root: string,
  options: RunCuratorOptions,
): Promise<CuratorRunReport> {
  if (!options.dryRun) {
    throw new Error('curator apply mode lands in P2.M4.T2');
  }
  const proposals = await scanMemory(root, {
    now: options.now,
    ...(options.staleDays === undefined ? {} : { staleDays: options.staleDays }),
  });
  const report: CuratorRunReport = {
    agentRef: options.agentRef,
    ts: options.now.toISOString(),
    dryRun: options.dryRun,
    proposals,
  };
  const day = report.ts.slice(0, 10);
  const logDir = path.join(options.auditHome, 'audit');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(
    path.join(logDir, `curator-${day}.ndjson`),
    `${JSON.stringify(report)}\n`,
  );
  return report;
}
