import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Co-edit detection primitives (ADR-009, spec §20 OQ1): a human editing an
 * agent-owned tree mid-task pauses the task behind an approval. These are
 * the pure pieces — snapshot and diff; the scheduler owns the timing.
 */

/**
 * `git status --porcelain` snapshot of `repoPath`, sorted for deterministic
 * comparison. Gitignored files never appear (they are not co-edit surface).
 */
export async function worktreeStatus(repoPath: string): Promise<string[]> {
  const { stdout } = await run('git', ['status', '--porcelain'], {
    cwd: repoPath,
  });
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

/** Extract the path from a porcelain line (rename syntax `a -> b` → `b`). */
function porcelainPath(line: string): string {
  const body = line.slice(3); // skip "XY " status columns
  const arrow = body.indexOf(' -> ');
  return (arrow === -1 ? body : body.slice(arrow + 4)).trim();
}

/**
 * Paths that differ between two snapshots, in either direction, sorted.
 * Deterministic: identical inputs always yield identical output.
 */
export function diffStatuses(before: string[], after: string[]): string[] {
  const beforePaths = new Set(before.map(porcelainPath));
  const afterPaths = new Set(after.map(porcelainPath));
  const changed = new Set<string>();
  for (const p of beforePaths) if (!afterPaths.has(p)) changed.add(p);
  for (const p of afterPaths) if (!beforePaths.has(p)) changed.add(p);
  return [...changed].sort((a, b) => a.localeCompare(b));
}
