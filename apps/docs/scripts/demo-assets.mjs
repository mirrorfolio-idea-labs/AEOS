#!/usr/bin/env node
// Reproducible demo assets (P5.M2.T4): boots a throwaway daemon on the demo
// provider, drives the golden path, and writes
//   docs/assets/ade-session.png    — an agent streaming, parked on an approval
//   docs/assets/ade-approvals.png  — the approvals inbox
//   docs/assets/ade-review.png     — the review pane on the agent's diff
//   docs/assets/golden-path.cast   — asciicast v2 of the CLI golden path
// Run: pnpm -F @aeos/docs demo:assets   (needs a built repo + chromium;
// AEOS_CHROMIUM=/path/to/chromium overrides Playwright's browser).
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(ROOT, 'docs', 'assets');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'main.js');
const PORT = 9711;
const URL = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-demo-'));
const repo = path.join(scratch, 'acme-api');
fs.mkdirSync(repo);
const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
git('init', '-q', '-b', 'main');
fs.writeFileSync(path.join(repo, 'README.md'), '# acme-api\n\nPayments service.\n');
git('add', '-A');
git('-c', 'user.name=you', '-c', 'user.email=you@example.com', 'commit', '-qm', 'init');

const daemon = spawn(process.execPath, [path.join(ROOT, 'apps', 'aeosd', 'dist', 'main.js'), 'run'], {
  env: { PATH: process.env.PATH ?? '', AEOS_HOME: path.join(scratch, 'home'), AEOS_PORT: String(PORT), AEOS_PROVIDER: 'fake', AEOS_FAKE_PACE_MS: '120' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
const done = () => {
  daemon.kill('SIGKILL');
  fs.rmSync(scratch, { recursive: true, force: true });
};
process.on('exit', done);
let log = '';
daemon.stderr.on('data', (c) => (log += c));
for (let i = 0; i < 200 && !log.includes('aeosd ready'); i++) await new Promise((r) => setTimeout(r, 50));

// ── terminal cast: the CLI golden path, recorded as asciicast v2 ──
const cast = [JSON.stringify({ version: 2, width: 100, height: 28, title: 'AEOS golden path (demo provider)', env: { SHELL: '/bin/bash', TERM: 'xterm-256color' } })];
let clock = 0.5;
const type = (text) => {
  for (const ch of text) {
    cast.push(JSON.stringify([Number(clock.toFixed(3)), 'o', ch]));
    clock += 0.035;
  }
};
const run = async (args) => {
  type(`$ aeos ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\r\n`);
  const r = await promisify(execFile)(process.execPath, [CLI, ...args], { env: { ...process.env, AEOS_API_URL: URL } }).catch((e) => e);
  for (const line of `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd().split('\n')) {
    clock += 0.25;
    cast.push(JSON.stringify([Number(clock.toFixed(3)), 'o', `${line}\r\n`]));
  }
  clock += 0.8;
};
await run(['workspace', 'create', 'acme', '--name', 'Client Acme']);
await run(['agent', 'create', 'backend-dev', '--workspace', 'acme', '--name', 'Backend Dev']);
await run(['repo', 'bind', 'api', '--workspace', 'acme', '--agent', 'backend-dev', '--path', repo, '--verify', 'test -f README.md']);
await run(['objective', 'create', 'retry-logic', '--workspace', 'acme', '--agent', 'backend-dev', '--title', 'Add retry logic to payment webhooks', '--repo', 'api', '--task', 'T1: add exponential backoff to the webhook sender']);

// ── screenshots: the same agent, live in the web UI ──
const browser = await chromium.launch(process.env.AEOS_CHROMIUM ? { executablePath: process.env.AEOS_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${URL}/?agent=acme/backend-dev`);
await page.getByTestId('objective-id').fill('retry-logic');
await page.getByTestId('objective-title').fill('Add retry logic to payment webhooks');
await page.getByTestId('objective-tasks').fill('T1: add exponential backoff to the webhook sender');
await page.getByTestId('run-objective').click();
await page.getByTestId('console').getByText('approval.request').first().waitFor({ timeout: 30_000 });
await page.screenshot({ path: path.join(OUT, 'ade-session.png') });
// the demo provider streams but does not edit: stand in for the agent's edit
// while it is parked (a real harness writes here) — AEOS commits it at task end
const worktree = path.join(scratch, 'home', 'workspaces', 'acme', 'agents', 'backend-dev', 'worktrees', 'api', 'retry-logic');
fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
fs.writeFileSync(
  path.join(worktree, 'src', 'webhook-sender.ts'),
  [
    "const MAX_ATTEMPTS = 5;",
    "",
    "/** Deliver a webhook, retrying with exponential backoff (250ms → 4s). */",
    "export async function sendWebhook(url: string, body: unknown): Promise<Response> {",
    "  for (let attempt = 1; ; attempt++) {",
    "    const response = await fetch(url, { method: 'POST', body: JSON.stringify(body) });",
    "    if (response.ok || attempt === MAX_ATTEMPTS) return response;",
    "    await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));",
    "  }",
    "}",
    "",
  ].join('\n'),
);
await page.getByTestId('tab-approvals').click();
await page.getByTestId('approvals-row').first().waitFor();
await page.screenshot({ path: path.join(OUT, 'ade-approvals.png') });
await page.locator('[data-testid^="approval-approve-"]').first().click();
await page.getByTestId('approvals-empty').waitFor({ timeout: 15_000 });
await new Promise((r) => setTimeout(r, 2500));
await page.getByTestId('tab-review').click();
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(OUT, 'ade-review.png') });
await browser.close();

await run(['objective', 'status', 'retry-logic', '--workspace', 'acme', '--agent', 'backend-dev']);
await run(['inbox']);
fs.writeFileSync(path.join(OUT, 'golden-path.cast'), cast.join('\n') + '\n');
console.log(`demo-assets: wrote ${fs.readdirSync(OUT).join(', ')} → docs/assets/`);
process.exit(0);
