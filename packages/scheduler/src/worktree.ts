import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RepoBinding } from '@aeos/contracts';

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export interface ObjectiveWorktree {
  /** Absolute worktree path the harness runs in. */
  dir: string;
  /** Agent branch the worktree has checked out. */
  branch: string;
  /** Commit the branch was created from (review "branch" scope diffs against it). */
  baseCommit: string;
}

export interface EnsureWorktreeOptions {
  repo: RepoBinding;
  /** `<AEOS_HOME>/workspaces/<ws>/agents/<agent>`. */
  agentDir: string;
  agentId: string;
  objectiveId: string;
}

export const worktreeBranch = (agentId: string, objectiveId: string): string =>
  `aeos/${agentId}/${objectiveId}`;

export const worktreeDir = (agentDir: string, repoId: string, objectiveId: string): string =>
  path.join(agentDir, 'worktrees', repoId, objectiveId);

/**
 * One git worktree per (agent, repo, objective) — spec §10. Agents never
 * touch the user's checkout: the worktree lives under the agent dir on its
 * own `aeos/<agent>/<objective>` branch. Idempotent — resuming an objective
 * after a crash re-attaches the existing worktree and branch unchanged.
 */
export async function ensureObjectiveWorktree(opts: EnsureWorktreeOptions): Promise<ObjectiveWorktree> {
  const dir = worktreeDir(opts.agentDir, opts.repo.id, opts.objectiveId);
  const branch = worktreeBranch(opts.agentId, opts.objectiveId);
  const source = opts.repo.path;
  if (!existsSync(source)) {
    throw new Error(`repo binding "${opts.repo.id}": ${source} does not exist`);
  }
  if (!existsSync(dir)) {
    await mkdir(path.dirname(dir), { recursive: true });
    const branchExists = await git(source, ['branch', '--list', branch]).then((out) => out.trim().length > 0);
    if (branchExists) {
      await git(source, ['worktree', 'add', dir, branch]);
    } else {
      await git(source, ['worktree', 'add', '-b', branch, dir, opts.repo.baseRef ?? 'HEAD']);
    }
  }
  const baseCommit = (
    await git(dir, ['merge-base', 'HEAD', opts.repo.baseRef ?? (await defaultBase(source))])
  ).trim();
  return { dir, branch, baseCommit };
}

/** The checkout's current HEAD commit — the default base when no baseRef is bound. */
async function defaultBase(source: string): Promise<string> {
  return (await git(source, ['rev-parse', 'HEAD'])).trim();
}

/**
 * Commit everything the task left in the worktree as one agent commit.
 * Returns the new commit sha, or `undefined` when the task changed nothing.
 * Author identity is the agent so `git log` attributes the work honestly.
 */
export async function commitTaskWork(
  dir: string,
  message: string,
  author: { name: string; email: string },
): Promise<string | undefined> {
  await git(dir, ['add', '-A']);
  const staged = await git(dir, ['diff', '--cached', '--name-only']);
  if (staged.trim().length === 0) return undefined;
  await git(dir, [
    '-c',
    `user.name=${author.name}`,
    '-c',
    `user.email=${author.email}`,
    'commit',
    '--no-verify',
    '-m',
    message,
  ]);
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

export type DiffScope = 'uncommitted' | 'branch' | 'last-commit';

/**
 * Unified diff of an objective worktree for the review pane (herdr-reviewr
 * scopes, adapted): `uncommitted` = working tree vs HEAD incl. untracked,
 * `branch` = everything since the objective started, `last-commit` = the
 * most recent task commit.
 */
export async function worktreeDiff(dir: string, scope: DiffScope, baseCommit?: string): Promise<string> {
  if (scope === 'uncommitted') {
    await git(dir, ['add', '-A', '--intent-to-add']);
    return git(dir, ['diff', 'HEAD', '--no-color']);
  }
  if (scope === 'last-commit') {
    const parents = (await git(dir, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' ');
    if (parents.length < 2) return git(dir, ['show', '--no-color', '--format=', 'HEAD']);
    return git(dir, ['diff', '--no-color', 'HEAD~1', 'HEAD']);
  }
  if (baseCommit === undefined) throw new Error('branch scope needs the objective base commit');
  return git(dir, ['diff', '--no-color', baseCommit]);
}
