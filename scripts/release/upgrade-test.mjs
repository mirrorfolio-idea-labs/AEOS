#!/usr/bin/env node
// Upgrade test (P5.M5.T2): state written by an OLDER release must be read and
// resumed by THIS build, with no manual steps (docs/compatibility.md).
//
//   node scripts/release/upgrade-test.mjs <baseline-ref> [<baseline-ref> …]
//
// For each ref: build it in a git worktree, let its daemon (demo provider)
// create a workspace + agent, complete one objective and leave a second one
// unstarted; stop it; boot the CURRENT daemon (this checkout, already built)
// on the same AEOS_HOME and check that everything is still there, readable,
// and that the pending objective runs to completion — with a clean log.
// Only the HTTP surface shared by every version is used.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const refs = process.argv.slice(2);
if (refs.length === 0) {
  console.error('usage: upgrade-test.mjs <baseline-ref> …');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`upgrade-test: ${m}`);

async function boot(mainJs, home, port) {
  const child = spawn(process.execPath, [mainJs, 'run'], {
    env: { PATH: process.env.PATH ?? '', HOME: home, AEOS_HOME: home, AEOS_PORT: String(port), AEOS_PROVIDER: 'fake', AEOS_FAKE_PACE_MS: '5' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  for (let i = 0; i < 300 && !stderr.includes('aeosd ready') && child.exitCode === null; i++) await sleep(50);
  if (!stderr.includes('aeosd ready')) throw new Error(`daemon did not start:\n${stderr}`);
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text);
    return json.data ?? json;
  };
  const stop = async () => {
    child.kill('SIGTERM');
    for (let i = 0; i < 100 && child.exitCode === null; i++) await sleep(50);
    if (child.exitCode === null) child.kill('SIGKILL');
  };
  return { call, stop, stderr: () => stderr };
}

/** Start an objective and drive it to completion, approving anything parked (P2+). */
async function runToCompletion(d, q, id) {
  await d.call('POST', `/v1/objectives/${id}/start?${q}`, {});
  for (let i = 0; i < 600; i++) {
    const s = await d.call('GET', `/v1/objectives/${id}?${q}`);
    if (s.tasks?.length > 0 && s.tasks.every((t) => t.status === 'completed')) return s;
    const pending = await d.call('GET', '/v1/approvals').catch(() => undefined); // v0.1 has no approvals
    for (const p of pending?.pending ?? []) {
      await d.call('POST', `/v1/approvals/${p.requestId}`, { decision: 'approve' }).catch(() => undefined);
    }
    await sleep(100);
  }
  throw new Error(`objective ${id} did not complete`);
}

let failures = 0;
for (const ref of refs) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-upgrade-src-'));
  fs.rmSync(wt, { recursive: true, force: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-upgrade-home-'));
  try {
    log(`${ref}: building baseline`);
    execFileSync('git', ['worktree', 'add', '--detach', wt, ref], { cwd: ROOT, stdio: 'ignore' });
    execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: wt, stdio: 'ignore' });
    execFileSync('pnpm', ['--filter', '@aeos/aeosd...', 'build'], { cwd: wt, stdio: 'ignore' });

    const q = 'workspaceId=legacy&agentId=dev';
    const old = await boot(path.join(wt, 'apps', 'aeosd', 'dist', 'main.js'), home, 9340);
    await old.call('POST', '/v1/workspaces', { id: 'legacy', name: 'Legacy' });
    await old.call('POST', '/v1/agents', {
      id: 'dev',
      workspaceId: 'legacy',
      name: 'Dev',
      harness: { provider: 'claude-code', featureToggles: { plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false } },
      credentialProfileId: 'cp',
    });
    await old.call('POST', '/v1/objectives', { workspaceId: 'legacy', agentId: 'dev', id: 'done-before', title: 'Done before the upgrade', tasks: [{ id: 'T1', title: 'old work' }] });
    await runToCompletion(old, q, 'done-before');
    await old.call('POST', '/v1/objectives', { workspaceId: 'legacy', agentId: 'dev', id: 'after-upgrade', title: 'Started after the upgrade', tasks: [{ id: 'T1', title: 'new work' }] });
    await old.stop();
    log(`${ref}: baseline wrote its state`);

    const cur = await boot(path.join(ROOT, 'apps', 'aeosd', 'dist', 'main.js'), home, 9341);
    const workspaces = await cur.call('GET', '/v1/workspaces');
    if (!workspaces.some((w) => w.id === 'legacy')) throw new Error('workspace lost');
    const agents = await cur.call('GET', '/v1/agents?workspaceId=legacy');
    if (!agents.some((a) => a.id === 'dev')) throw new Error('agent lost');
    const before = await cur.call('GET', `/v1/objectives/done-before?${q}`);
    if (!before.tasks.every((t) => t.status === 'completed') || before.checkpoints.length === 0) {
      throw new Error(`completed objective not preserved: ${JSON.stringify(before)}`);
    }
    await runToCompletion(cur, q, 'after-upgrade');
    const logErrors = cur.stderr().split('\n').filter((l) => /error|failed/i.test(l) && !/^\s+at /.test(l));
    await cur.stop();
    if (logErrors.length > 0) throw new Error(`current daemon logged errors on the old state:\n${logErrors.join('\n')}`);
    log(`${ref} → current: PASS (state preserved, pending objective resumed, clean log)`);
  } catch (error) {
    failures++;
    console.error(`upgrade-test: ${ref} → current: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'ignore' });
    } catch {
      // worktree never created
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}
process.exit(failures === 0 ? 0 : 1);
