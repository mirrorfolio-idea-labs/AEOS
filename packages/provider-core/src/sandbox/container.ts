import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CommandContext } from '../adapter.js';

/**
 * Container sandbox tier (P4.M1, spec §10). The harness argv is wrapped in a
 * `docker run` that sees ONLY:
 *
 * - the objective worktree (read-write, same path as on the host, so paths
 *   in transcripts and tool calls stay meaningful);
 * - the git common dir behind that worktree (git needs its objects/refs);
 * - the agent's harness profile dir (read-write — harness config/state);
 * - explicitly listed extra mounts (managed/BYO harness binaries, read-only).
 *
 * Nothing else of the host filesystem exists inside. Profile env (which can
 * carry resolved secrets) is forwarded with `-e KEY` — the docker client
 * reads the value from its own env — so secrets never appear in argv / `ps`.
 */

export interface ContainerMount {
  host: string;
  readOnly?: boolean;
}

export interface ContainerSpec {
  image: string;
  network: 'none' | 'bridge';
  /** Extra read-only/read-write mounts (harness binaries). */
  mounts?: readonly ContainerMount[];
  /** Label value tying containers to one AEOS home (orphan reaping). */
  homeLabel: string;
  /** `docker` executable (tests may point elsewhere). */
  docker?: string;
  /** Run as this uid:gid so worktree files stay owned by the host user. */
  user?: string;
}

export const CONTAINER_LABEL = 'aeos.managed';
export const CONTAINER_HOME_LABEL = 'aeos.home';

/** Stable, short label for an AEOS home (a path is not a valid label value everywhere). */
export function homeLabelFor(home: string): string {
  return createHash('sha256').update(path.resolve(home)).digest('hex').slice(0, 16);
}

export const containerName = (sessionId: string): string => `aeos-${sessionId.toLowerCase()}`;

/**
 * The git common dir behind a linked worktree (`<repo>/.git`), or
 * undefined when `workdir` is not one. Worktrees keep a `.git` FILE
 * pointing at `<common>/worktrees/<name>`.
 */
export function gitCommonDir(workdir: string): string | undefined {
  let pointer: string;
  try {
    pointer = fs.readFileSync(path.join(workdir, '.git'), 'utf8');
  } catch {
    return undefined; // a directory (a plain repo — already mounted) or nothing
  }
  const gitdir = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
  if (gitdir === undefined) return undefined;
  const worktreeGitDir = path.resolve(workdir, gitdir);
  try {
    const common = fs.readFileSync(path.join(worktreeGitDir, 'commondir'), 'utf8').trim();
    return path.resolve(worktreeGitDir, common);
  } catch {
    return path.dirname(path.dirname(worktreeGitDir));
  }
}

/** Wrap a harness argv so it runs inside the container tier. */
export function containerArgv(command: readonly string[], ctx: CommandContext, spec: ContainerSpec): string[] {
  const mounts = new Map<string, boolean>(); // host path → readOnly
  const add = (host: string, readOnly: boolean): void => {
    const resolved = path.resolve(host);
    // a read-write mount wins over a read-only one of the same path
    mounts.set(resolved, (mounts.get(resolved) ?? true) && readOnly);
  };
  add(ctx.workdir, false);
  add(ctx.profile.rootDir, false);
  const common = gitCommonDir(ctx.workdir);
  if (common !== undefined) add(common, false);
  for (const m of spec.mounts ?? []) add(m.host, m.readOnly ?? true);

  const env = Object.keys(ctx.profile.env).sort();
  const argv = [
    spec.docker ?? 'docker',
    'run',
    '--rm',
    '--init',
    '--name',
    containerName(ctx.sessionId),
    '--label',
    `${CONTAINER_LABEL}=1`,
    '--label',
    `${CONTAINER_HOME_LABEL}=${spec.homeLabel}`,
    '--network',
    spec.network,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    ...(spec.user === undefined ? [] : ['--user', spec.user]),
    // harnesses expect a writable HOME; the profile dir is the only one
    ...(env.includes('HOME') ? [] : ['-e', `HOME=${ctx.profile.rootDir}`]),
    ...env.flatMap((key) => ['-e', key]),
    ...[...mounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([host, readOnly]) => ['-v', `${host}:${host}${readOnly ? ':ro' : ''}`]),
    '-w',
    ctx.workdir,
    spec.image,
    ...command,
  ];
  return argv;
}

/** The daemon's uid:gid, when the platform has them (not on Windows). */
export function currentUser(): string | undefined {
  return typeof process.getuid === 'function' && typeof process.getgid === 'function'
    ? `${String(process.getuid())}:${String(process.getgid())}`
    : undefined;
}

/**
 * Remove containers this AEOS home started that outlived their session
 * (daemon crash / SIGKILL). Session resume re-spawns a fresh container from
 * the checkpoint's provider resume token, so a leftover is never adopted in
 * place — reaping it keeps the host clean. Best-effort: no docker → no-op.
 */
export function reapContainers(homeLabel: string, docker = 'docker'): string[] {
  try {
    const ids = execFileSync(
      docker,
      ['ps', '-aq', '--filter', `label=${CONTAINER_LABEL}=1`, '--filter', `label=${CONTAINER_HOME_LABEL}=${homeLabel}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    )
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (ids.length > 0) execFileSync(docker, ['rm', '-f', ...ids], { stdio: 'ignore', timeout: 30_000 });
    return ids;
  } catch {
    return [];
  }
}

/** Is a docker daemon reachable? */
export function dockerAvailable(docker = 'docker'): boolean {
  try {
    execFileSync(docker, ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
