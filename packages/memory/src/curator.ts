import fs from 'node:fs';
import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MEMORY_DIRS, readIndex, type MemoryIndex } from './layout.js';
import {
  applyProposals,
  enqueueProposal,
  type ApplyResult,
  type MemoryProposal,
} from './propose.js';

/**
 * Memory curator (spec §8 rule 4, ROADMAP P2.M4): an idle-triggered job that
 * ages, deduplicates, and summarizes memory — archiving, never deleting —
 * and applies every change through the `memory.propose` pipeline. v0.2
 * operations are deterministic by design: the milestone exit gate requires a
 * deterministic run, so model-backed summarization stays behind a pluggable
 * seam until the P3 router exists.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Typed rejection for roots a caller should never hand the curator. */
export class CuratorPathError extends Error {}

/** Roots must be absolute and already normalized — no `..` escapes. */
function assertSafeRoot(root: string): void {
  if (!path.isAbsolute(root)) {
    throw new CuratorPathError(`curator root must be absolute: ${root}`);
  }
  if (path.resolve(root) !== root || root.split(path.sep).includes('..')) {
    throw new CuratorPathError(`curator root must be normalized without '..' segments: ${root}`);
  }
}

export type CuratorProposal =
  | { op: 'archive'; path: string; reason: 'stale' | 'duplicate' }
  | {
      op: 'consolidate';
      paths: [string, string];
      path: string;
      title: string;
      hook: string;
      reason: 'over-budget';
    };

export interface CuratorRunReport {
  agentRef: string;
  ts: string;
  dryRun: boolean;
  proposals: CuratorProposal[];
  /** Present on apply-mode runs: one entry per proposal, in order. */
  results?: ApplyResult[];
}

export interface ScanMemoryOptions {
  now: Date;
  /** Files untouched longer than this are stale (default 30 days). */
  staleDays?: number;
}

interface FileMeta {
  relPath: string;
  mtimeMs: number;
  content: string;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const stemOf = (relPath: string): string => {
  const base = path.basename(relPath);
  return base.replace(/\.[^.]+$/, '');
};

/**
 * Built-in extractive summarizer: keeps the leading half of each source
 * (at least one char), newline-joined — deterministic, always smaller than
 * the combined originals, so consolidation frees budget even for tiny files.
 */
function takeLeading(text: string): string {
  return text.slice(0, Math.max(1, Math.floor(text.length / 2)));
}

function extractiveSummary(
  sources: Array<{ path: string; content: string }>,
): string {
  return `${sources.map((source) => takeLeading(source.content)).join('\n')}\n`;
}

/** Next free `<stem>.curated.md`-style target inside `dir` (no clobbering). */
function curatedTarget(root: string, dir: string, oldestRelPath: string): string {
  const stem = stemOf(oldestRelPath);
  let candidate = `${dir}/${stem}.curated.md`;
  let n = 2;
  while (fs.existsSync(path.join(root, candidate))) {
    candidate = `${dir}/${stem}.curated-${n}.md`;
    n += 1;
  }
  return candidate;
}

interface DirScan {
  files: FileMeta[];
  budgets: Record<string, number>;
}

async function collectFiles(root: string): Promise<Map<string, DirScan>> {
  let index: MemoryIndex;
  try {
    index = await readIndex(root);
  } catch {
    index = { budgets: {}, lines: [] };
  }
  const scans = new Map<string, DirScan>();
  for (const dir of MEMORY_DIRS) {
    if (dir === 'identity') continue; // spec §8: identity is stable
    const absDir = path.join(root, dir);
    let names: string[];
    try {
      names = await readdir(absDir);
    } catch {
      continue; // missing dirs contribute no files
    }
    const files: FileMeta[] = [];
    for (const name of names) {
      const relPath = `${dir}/${name}`;
      const info = await stat(path.join(root, relPath));
      if (!info.isFile()) continue;
      files.push({
        relPath,
        mtimeMs: info.mtimeMs,
        content: await readFile(path.join(root, relPath), 'utf8'),
      });
    }
    scans.set(dir, { files, budgets: index.budgets });
  }
  return scans;
}

/**
 * Deterministic scan of the memory tree producing the proposal list:
 * over-budget consolidations (two oldest files per dir), duplicate archives
 * (identical content keeps the lexicographically-first path), then stale
 * archives globally ordered by mtime ascending, then path ascending. Each
 * total order makes identical trees always yield identical lists.
 * `identity/`, `MEMORY.md`, `.archive/`, and `.proposals/` are never touched.
 */
export async function scanMemory(
  root: string,
  options: ScanMemoryOptions,
): Promise<CuratorProposal[]> {
  const staleDays = options.staleDays ?? 30;
  const cutoff = options.now.getTime() - staleDays * DAY_MS;
  const scans = await collectFiles(root);

  const proposals: CuratorProposal[] = [];
  const consumed = new Set<string>();

  // Pass 1 — over-budget dirs: consolidate their two oldest files.
  for (const [dir, scan] of scans) {
    const budget = scan.budgets[dir];
    if (budget === undefined || scan.files.length < 2) continue;
    const usage = scan.files.reduce((sum, file) => sum + file.content.length, 0);
    if (usage <= budget) continue;
    const oldest = [...scan.files]
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.relPath.localeCompare(b.relPath))
      .slice(0, 2);
    const targetRel = curatedTarget(root, dir, oldest[0]!.relPath);
    proposals.push({
      op: 'consolidate',
      paths: [oldest[0]!.relPath, oldest[1]!.relPath],
      path: targetRel,
      title: stemOf(oldest[0]!.relPath),
      hook: 'curated summary of 2 files',
      reason: 'over-budget',
    });
    consumed.add(targetRel);
    for (const file of oldest) consumed.add(file.relPath);
  }

  // Pass 2 — duplicates: identical content keeps the lexicographically-first path.
  for (const [, scan] of scans) {
    const byHash = new Map<string, FileMeta[]>();
    for (const file of scan.files) {
      if (consumed.has(file.relPath)) continue;
      const group = byHash.get(sha256(file.content)) ?? [];
      group.push(file);
      byHash.set(sha256(file.content), group);
    }
    const keptFirst = [...byHash.values()]
      .filter((group) => group.length > 1)
      .map((group) => group.sort((a, b) => a.relPath.localeCompare(b.relPath))[0]!.relPath)
      .sort((a, b) => a.localeCompare(b));
    for (const keep of keptFirst) {
      const groupHash = [...byHash.entries()].find(
        ([, group]) => group[0]!.relPath === keep,
      )![0];
      for (const file of byHash.get(groupHash)!) {
        if (file.relPath === keep || consumed.has(file.relPath)) continue;
        proposals.push({ op: 'archive', path: file.relPath, reason: 'duplicate' });
        consumed.add(file.relPath);
      }
    }
  }

  // Pass 3 — stale: globally mtime asc, then path asc.
  const stale: FileMeta[] = [];
  for (const [, scan] of scans) {
    for (const file of scan.files) {
      if (!consumed.has(file.relPath) && file.mtimeMs <= cutoff) stale.push(file);
    }
  }
  stale.sort((a, b) => a.mtimeMs - b.mtimeMs || a.relPath.localeCompare(b.relPath));
  for (const file of stale) proposals.push({ op: 'archive', path: file.relPath, reason: 'stale' });

  return proposals;
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
  /**
   * Pluggable summarizer for consolidations (P3 router will supply a
   * cheap-model implementation). Default: built-in extractive summary.
   */
  summarize?: (sources: Array<{ path: string; content: string }>) => Promise<string>;
  /** Re-exported applyProposals hook — the daemon publishes memory.written. */
  onApplied?: Parameters<typeof applyProposals>[1];
}

const proposalId = (proposal: CuratorProposal): string =>
  `cur-${sha256(JSON.stringify(proposal)).slice(0, 16)}`;

/**
 * One curator pass over the memory tree at `root`. Every run — including
 * dry-runs — appends one NDJSON line to `<auditHome>/audit/curator-<utc-date>.ndjson`
 * (append-only, own trail per spec §8.4). Dry-run mutates nothing else; apply
 * mode enqueues each proposal and applies through `memory.propose`
 * (atomic, budget-checked, policy-gated upstream).
 */
export async function runCurator(
  root: string,
  options: RunCuratorOptions,
): Promise<CuratorRunReport> {
  assertSafeRoot(root);
  const proposals = await scanMemory(root, {
    now: options.now,
    ...(options.staleDays === undefined ? {} : { staleDays: options.staleDays }),
  });
  let results: ApplyResult[] | undefined;
  if (!options.dryRun) {
    const queue: MemoryProposal[] = [];
    for (const proposal of proposals) {
      const id = proposalId(proposal);
      if (proposal.op === 'archive') {
        queue.push({ id, op: 'archive', path: proposal.path });
      } else {
        const sources = await Promise.all(
          proposal.paths.map(async (relPath) => ({
            path: relPath,
            content: await readFile(path.join(root, relPath), 'utf8'),
          })),
        );
        const content =
          options.summarize === undefined
            ? extractiveSummary(sources)
            : await options.summarize(sources);
        queue.push({
          id,
          op: 'consolidate',
          paths: [...proposal.paths],
          path: proposal.path,
          title: proposal.title,
          hook: proposal.hook,
          content,
        });
      }
    }
    for (const item of queue) await enqueueProposal(root, item);
    results = await applyProposals(root, options.onApplied);
  }
  const report: CuratorRunReport = {
    agentRef: options.agentRef,
    ts: options.now.toISOString(),
    dryRun: options.dryRun,
    proposals,
    ...(results === undefined ? {} : { results }),
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
