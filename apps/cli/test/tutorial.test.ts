import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AeosClient } from '@aeos/sdk';

/**
 * Docs that run (P5.M2.T2): every `aeos …` line in the `tutorial:run`
 * blocks of docs/getting-started/first-agent.md is executed, in order,
 * against a fresh daemon on the demo provider. A line ending in
 * `# exit N` must exit N; every other line must exit 0. A background
 * "human" approves whatever parks, as the reader would in the UI.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'main.js');
const AEOSD = path.join(ROOT, 'apps', 'aeosd', 'dist', 'main.js');
const TUTORIAL = path.join(ROOT, 'docs', 'getting-started', 'first-agent.md');

export function tutorialCommands(markdown: string): Array<{ line: string; exit: number }> {
  const out: Array<{ line: string; exit: number }> = [];
  const re = /<!-- tutorial:run -->\s*```bash\n([\s\S]*?)```/g;
  for (let m = re.exec(markdown); m !== null; m = re.exec(markdown)) {
    for (const raw of (m[1] as string).split('\n')) {
      const line = raw.trim();
      if (!line.startsWith('aeos ')) continue;
      const exit = /#\s*exit (\d+)/.exec(line);
      out.push({ line: line.replace(/\s+#.*$/, ''), exit: exit === null ? 0 : Number(exit[1]) });
    }
  }
  return out;
}

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const c of cleanups.reverse()) c();
});

describe('first-agent tutorial runs as written', () => {
  it('every tutorial command succeeds (or exits as documented) against a fresh daemon', { timeout: 300_000 }, async () => {
    const commands = tutorialCommands(fs.readFileSync(TUTORIAL, 'utf8'));
    expect(commands.length).toBeGreaterThanOrEqual(9);

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-tutorial-'));
    const home = path.join(scratch, 'home');
    const repo = path.join(scratch, 'demo-repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), '# demo\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=u', '-c', 'user.email=u@u', 'commit', '-qm', 'init'], { cwd: repo });

    const port = 9600 + (process.pid % 90);
    const daemon = spawn(process.execPath, [AEOSD, 'run'], {
      env: { PATH: process.env['PATH'] ?? '', AEOS_HOME: home, AEOS_PORT: String(port), AEOS_PROVIDER: 'fake', AEOS_FAKE_PACE_MS: '5' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    daemon.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));
    cleanups.push(() => {
      daemon.kill('SIGKILL');
      fs.rmSync(scratch, { recursive: true, force: true });
    });
    for (let i = 0; i < 300 && !stderr.includes('aeosd ready'); i++) await new Promise((r) => setTimeout(r, 50));
    const url = `http://127.0.0.1:${String(port)}`;

    // the reader, in another window, approves what parks
    const client = new AeosClient({ baseUrl: url });
    const human = setInterval(() => {
      void client
        .listApprovals()
        .then(async (pending) => {
          for (const p of pending) await client.resolveApproval(p.requestId, 'approve').catch(() => undefined);
        })
        .catch(() => undefined);
    }, 150);
    cleanups.push(() => clearInterval(human));

    const env = { ...process.env, AEOS_API_URL: url, DEMO_REPO: repo, AEOS_HOME: home };
    for (const { line, exit } of commands) {
      // run through a shell so quoting and $DEMO_REPO expand exactly as for the reader
      // async, so the background "human" keeps approving while the CLI waits
      const result = await promisify(execFile)('sh', ['-c', `node ${JSON.stringify(CLI)} ${line.slice('aeos '.length)}`], { env, timeout: 120_000 }).then(
        (r) => ({ status: 0, stdout: r.stdout, stderr: r.stderr }),
        (e: { code?: number; stdout?: string; stderr?: string }) => ({ status: typeof e.code === 'number' ? e.code : -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }),
      );
      expect(result.status, `\`${line}\`\n${result.stdout}\n${result.stderr}`).toBe(exit);
    }
    // every session the walkthrough spawned (planner included) had somewhere to write its transcript
    expect(stderr).not.toContain('TranscriptRoutingError');
    expect(stderr).not.toMatch(/objective .* errored/);
  });
});
