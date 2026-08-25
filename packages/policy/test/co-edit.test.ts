import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffStatuses, worktreeStatus } from '../src/index.js';

const run = promisify(execFile);

/**
 * P2.M5.T3 primitives: a porcelain snapshot of a repo and a deterministic
 * differ. The co-edit guard (ADR-009) pauses a task when these detect
 * foreign changes in an agent-owned tree.
 */
describe('co-edit detection (P2.M5.T3)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(path.join(os.tmpdir(), 'aeos-coedit-'));
    await run('git', ['init', '-q'], { cwd: repo });
    await run('git', ['config', 'user.email', 'test@aeos.local'], { cwd: repo });
    await run('git', ['config', 'user.name', 'Aeos Test'], { cwd: repo });
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
    await run('git', ['add', '.'], { cwd: repo });
    await run('git', ['commit', '-qm', 'init'], { cwd: repo });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('clean tree snapshots empty; edits appear as sorted porcelain lines', async () => {
    expect(await worktreeStatus(repo)).toEqual([]);
    await writeFile(path.join(repo, 'tracked.txt'), 'edited\n');
    await writeFile(path.join(repo, 'new.txt'), 'new\n');
    const status = await worktreeStatus(repo);
    expect(status).toEqual([' M tracked.txt', '?? new.txt']);
  });

  it('diffStatuses reports changed paths in both directions', () => {
    expect(diffStatuses([], [])).toEqual([]);
    expect(diffStatuses([' M a.txt'], [' M a.txt'])).toEqual([]);
    expect(diffStatuses([], ['?? b.txt', ' M c.txt'])).toEqual(['b.txt', 'c.txt']);
    expect(diffStatuses([' M gone.txt'], [])).toEqual(['gone.txt']);
  });

  it('ignores gitignored files entirely (they are not co-edit surface)', async () => {
    await writeFile(path.join(repo, '.gitignore'), 'scratch/\n');
    await run('git', ['add', '.gitignore'], { cwd: repo });
    await run('git', ['commit', '-qm', 'ignore scratch'], { cwd: repo });
    await mkdir(path.join(repo, 'scratch'), { recursive: true });
    await writeFile(path.join(repo, 'scratch', 'noise.txt'), 'noise\n');
    expect(await worktreeStatus(repo)).toEqual([]);
  });
});
