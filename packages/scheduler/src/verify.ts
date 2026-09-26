import { spawn } from 'node:child_process';
import type { Checkpoint } from '@aeos/contracts';

export type Verification = NonNullable<Checkpoint['verification']>;
export type VerifyOutcome = Verification['outcome'];

export interface VerifyResult extends Verification {
  /** Configuration problem (e.g. no commands) — blocks at once, no strikes. */
  fatal?: string;
}

export interface RunVerificationOptions {
  cwd: string;
  commands: readonly string[];
  /** Per-command wall clock (default 10 min). */
  timeoutMs?: number;
  /** Re-runs of a failing command before calling it a failure (default 1). */
  retries?: number;
  env?: NodeJS.ProcessEnv;
}

const TAIL = 4000;

function runOnce(command: string, cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-TAIL * 2);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      output += `\n[aeos] verification command timed out after ${String(timeoutMs)}ms`;
      try {
        process.kill(-(child.pid as number), 'SIGKILL'); // the whole process group
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? (signal === null ? 1 : 128 + 9), output: output.slice(-TAIL) });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, output: String(error) });
    });
  });
}

/**
 * Verification runner (P3.M3.T1, spec §12): run the objective's commands
 * (tests, lint, build) in the worktree, in order, stopping at the first
 * failure. A command that fails and then passes on retry is `flaky` — it
 * does not block progression but is recorded distinctly, so a flaky suite
 * shows up in checkpoints instead of hiding behind a green run.
 */
export async function runVerification(opts: RunVerificationOptions): Promise<VerifyResult> {
  if (opts.commands.length === 0) {
    return { outcome: 'fail', commands: [], fatal: 'no verification commands configured (repo binding `verify` or objective `verify`)' };
  }
  const retries = opts.retries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const env = { ...(opts.env ?? process.env), CI: '1' };
  const commands: Verification['commands'] = [];
  let flaky = false;
  for (const command of opts.commands) {
    let attempts = 0;
    let last = { exitCode: 1, output: '' };
    let failedOnce = false;
    while (attempts <= retries) {
      attempts += 1;
      last = await runOnce(command, opts.cwd, timeoutMs, env);
      if (last.exitCode === 0) break;
      failedOnce = true;
    }
    commands.push({ command, exitCode: last.exitCode, attempts, outputTail: last.output });
    if (last.exitCode !== 0) return { outcome: 'fail', commands };
    if (failedOnce) flaky = true;
  }
  return { outcome: flaky ? 'flaky' : 'pass', commands };
}

/** Human/agent-readable failure notes for the task that must fix it. */
export function renderVerifyFailure(verifyTaskId: string, result: VerifyResult): string {
  const failed = result.commands.find((c) => c.exitCode !== 0);
  const lines = [`## Verification ${verifyTaskId} failed — fix this before anything else`, ''];
  if (failed !== undefined) {
    lines.push(`Command: \`${failed.command}\` (exit ${String(failed.exitCode)}, ${String(failed.attempts)} attempt(s))`, '', '```', failed.outputTail.trimEnd(), '```');
  } else if (result.fatal !== undefined) {
    lines.push(result.fatal);
  }
  return lines.join('\n') + '\n';
}
