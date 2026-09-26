import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { containerArgv, containerName, gitCommonDir, homeLabelFor, type CommandContext } from '../src/index.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-sbx-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const ctx = (workdir: string): CommandContext => ({
  sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  workdir,
  profile: { rootDir: '/aeos/agents/dev/harness/claude', env: { CLAUDE_CONFIG_DIR: '/aeos/agents/dev/harness/claude/config', ANTHROPIC_API_KEY: 'sk-SECRET' }, argv: [] },
});

describe('container tier argv (P4.M1)', () => {
  it('mounts only the worktree, the profile and listed binaries; forwards env by NAME (never values)', () => {
    const argv = containerArgv(['/opt/bin/claude', '-p', 'hi'], ctx('/work/tree'), {
      image: 'aeos-runner:local',
      network: 'none',
      homeLabel: 'abc',
      user: '1000:1000',
      mounts: [{ host: '/opt/bin/claude', readOnly: true }],
    });
    expect(argv).toEqual([
      'docker', 'run', '--rm', '--init',
      '--name', 'aeos-01arz3ndektsv4rrffq69g5fav',
      '--label', 'aeos.managed=1', '--label', 'aeos.home=abc',
      '--network', 'none',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--user', '1000:1000',
      '-e', 'HOME=/aeos/agents/dev/harness/claude',
      '-e', 'ANTHROPIC_API_KEY', '-e', 'CLAUDE_CONFIG_DIR',
      '-v', '/aeos/agents/dev/harness/claude:/aeos/agents/dev/harness/claude',
      '-v', '/opt/bin/claude:/opt/bin/claude:ro',
      '-v', '/work/tree:/work/tree',
      '-w', '/work/tree',
      'aeos-runner:local',
      '/opt/bin/claude', '-p', 'hi',
    ]);
    expect(argv.join(' ')).not.toContain('sk-SECRET');
  });

  it('a read-write mount of the same path wins over a read-only one', () => {
    const argv = containerArgv(['x'], ctx('/work/tree'), { image: 'i', network: 'bridge', homeLabel: 'h', mounts: [{ host: '/work/tree', readOnly: true }] });
    expect(argv).toContain('/work/tree:/work/tree');
    expect(argv).not.toContain('/work/tree:/work/tree:ro');
  });

  it('adds the git common dir behind a linked worktree (git needs it), and nothing of the checkout', () => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    git('add', '-A');
    git('-c', 'user.name=u', '-c', 'user.email=u@u', 'commit', '-qm', 'init');
    const wt = path.join(dir, 'wt');
    git('worktree', 'add', '-q', wt);
    expect(gitCommonDir(wt)).toBe(fs.realpathSync(path.join(repo, '.git')));
    expect(gitCommonDir(repo)).toBeUndefined();
    const argv = containerArgv(['x'], ctx(wt), { image: 'i', network: 'bridge', homeLabel: 'h' });
    const volumes = argv.filter((_, i) => argv[i - 1] === '-v');
    expect(volumes.some((v) => v.startsWith(`${fs.realpathSync(path.join(repo, '.git'))}:`))).toBe(true);
    expect(volumes.some((v) => v.startsWith(`${repo}:`))).toBe(false);
  });

  it('labels are stable per home; names are docker-safe', () => {
    expect(homeLabelFor('/a/b')).toBe(homeLabelFor('/a/b/'));
    expect(homeLabelFor('/a/b')).not.toBe(homeLabelFor('/a/c'));
    expect(containerName('01ABC')).toMatch(/^[a-z0-9-]+$/);
  });
});
