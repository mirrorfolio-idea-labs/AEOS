import { execFileSync } from 'node:child_process';

/**
 * Minimal git wrapper for per-agent history (spec §7 portability). Always
 * `execFile` with an argument array — never a shell string. Identity is set
 * locally in each agent repo so commits work on machines (and CI runners)
 * with no global git config.
 */
function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

export function initRepo(dir: string): void {
  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.name', 'aeos']);
  git(dir, ['config', 'user.email', 'aeos@localhost']);
}

export function commitAll(dir: string, message: string): void {
  git(dir, ['add', '--all']);
  git(dir, ['commit', '--quiet', '-m', message]);
}
