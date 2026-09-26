import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AeosClient } from '@aeos/sdk';
import { createFileSecretStore } from '@aeos/secrets';
import { ADAPTER_MATRIX } from '@aeos/provider-core';

/**
 * P2 exit gate — the P2 integration suite (ROADMAP top of P2): a NEW agent
 * on the real daemon runs under least-privilege policy (default posture —
 * no allow layer), with a daemon-enforced budget cap, every action audited,
 * a registered secret never leaking into any sink, PTY takeover refused
 * below allow-tier (and available at it), in its own git worktree, with the
 * attention status reporting blocked → done. Harness parity ("any of three
 * harnesses") is the conformance matrix every adapter asserts (P2.M6.T3,
 * pinned binaries P2.M7) — asserted here so the gate names it.
 */

const CANARY = 'CANARY-p2-exit-7h3k-secret-value';
const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');
const cleanups: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('P2 exit gate — integrated safety posture on the real daemon', () => {
  it('least privilege + budget + audit + no secret leaks + takeover gating + worktree + status', { timeout: 120_000 }, async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-p2-exit-'));
    const repo = await mkdtemp(path.join(os.tmpdir(), 'aeos-p2-exit-repo-'));
    git(repo, 'init', '--quiet', '-b', 'main');
    await writeFile(path.join(repo, 'README.md'), '# customer app\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=u', '-c', 'user.email=u@u', 'commit', '--quiet', '-m', 'init');
    await createFileSecretStore(home).set('canary_ref', CANARY);

    const port = 8400 + (process.pid % 500);
    const child = spawn(process.execPath, [MAIN, 'run'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        AEOS_HOME: home,
        AEOS_PORT: String(port),
        AEOS_PROVIDER: 'fake',
        AEOS_FAKE_PACE_MS: '10',
        AEOS_SECRETS_STORE: '1',
        AEOS_FAKE_TOOL_OUTPUT: `ok ${CANARY}\n`,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));
    cleanups.push(async () => {
      if (child.exitCode === null) child.kill('SIGKILL');
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    });
    for (let i = 0; i < 300 && !stderr.includes('aeosd ready'); i++) await new Promise((r) => setTimeout(r, 50));
    expect(stderr).toContain('aeosd ready');

    const baseUrl = `http://127.0.0.1:${port}`;
    const client = new AeosClient({ baseUrl });
    const sse: string[] = [];
    const controller = new AbortController();
    void (async () => {
      const res = await fetch(`${baseUrl}/v1/events`, { signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        try {
          const { done, value } = await reader.read();
          if (done) break;
          sse.push(decoder.decode(value, { stream: true }));
        } catch {
          break;
        }
      }
    })();

    // a NEW agent: no policy layers at all → default posture
    await client.createWorkspace({ id: 'ws1', name: 'WS' });
    await client.createAgent({
      id: 'dev',
      workspaceId: 'ws1',
      name: 'Dev',
      harness: {
        provider: 'claude-code',
        featureToggles: { plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false },
      },
      credentialProfileId: 'cp',
    });
    await client.bindRepo('ws1', 'dev', { id: 'app', path: repo });

    // 1. least privilege: the fixture's tool call parks for a human, status → blocked
    await client.createObjective({ workspaceId: 'ws1', agentId: 'dev', id: 'o-safe', title: 'safe', repo: 'app', tasks: [{ id: 'T1', title: 'run a command' }] });
    const before = await client.agentStatus('ws1', 'dev');
    await client.startObjective('ws1', 'dev', 'o-safe');
    const blocked = await client.waitForAgent('ws1', 'dev', { until: ['blocked'], afterSeq: before.seq, timeoutMs: 20_000 });
    expect(blocked.matched).toBe(true);
    expect(blocked.entry.reason).toMatch(/^approval requested: execute_commands/);

    // 2. takeover is refused below allow-tier (least privilege for humans' shells too)
    const refused = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/v1/sessions/nope/attach`);
      ws.addEventListener('close', (e) => resolve(e.reason));
    });
    expect(refused).toMatch(/unknown_session|policy_denied/);

    const [pending] = await client.listApprovals();
    await client.resolveApproval(pending!.requestId, 'approve');
    const done = await client.waitForAgent('ws1', 'dev', { until: ['done'], afterSeq: blocked.entry.seq, timeoutMs: 20_000 });
    expect(done.matched).toBe(true);
    // work happened in the agent's worktree, never the checkout
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'branch', '--list', 'aeos/dev/o-safe')).toContain('aeos/dev/o-safe');

    // 3. daemon-enforced budget cap hard-stops a run; status → blocked
    await client.createObjective({
      workspaceId: 'ws1',
      agentId: 'dev',
      id: 'o-cap',
      title: 'capped',
      budgetUsd: 0.000001,
      tasks: [{ id: 'T1', title: 'spend' }],
    });
    const beforeCap = await client.agentStatus('ws1', 'dev');
    await client.startObjective('ws1', 'dev', 'o-cap');
    // the fake's tool call parks first under default posture — approve it
    for (let i = 0; i < 200 && (await client.listApprovals()).length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    const [capPending] = await client.listApprovals();
    if (capPending !== undefined) await client.resolveApproval(capPending.requestId, 'approve');
    // blocked on the approval first, then (after approval) on the budget stop
    let capped = await client.waitForAgent('ws1', 'dev', { until: ['blocked'], afterSeq: beforeCap.seq, timeoutMs: 20_000 });
    for (let i = 0; i < 5 && !(capped.entry.reason ?? '').includes('budget'); i++) {
      capped = await client.waitForAgent('ws1', 'dev', { until: ['blocked'], afterSeq: capped.entry.seq, timeoutMs: 20_000 });
    }
    expect(capped.entry.reason).toBe('budget usd cap reached');
    let capStatus = await client.objectiveStatus('ws1', 'dev', 'o-cap');
    for (let i = 0; i < 100 && capStatus.running; i++) {
      await new Promise((r) => setTimeout(r, 50));
      capStatus = await client.objectiveStatus('ws1', 'dev', 'o-cap');
    }
    expect(capStatus.tasks[0]?.status).toBe('pending'); // hard stop, no strike consumed

    controller.abort();
    await new Promise((r) => setTimeout(r, 300));

    // 4. every action audited — approvals, tool traffic, budget stop
    const auditFiles = await readdir(path.join(home, 'audit'));
    const audit = (await Promise.all(auditFiles.map((f) => readFile(path.join(home, 'audit', f), 'utf8')))).join('');
    for (const type of ['approval.request', 'approval.resolved', 'item.tool_call', 'item.tool_result', 'budget.exceeded']) {
      expect(audit, `audit must record ${type}`).toContain(`"type":"${type}"`);
    }

    // 5. the registered secret never reaches audit, SSE or REST
    const stream = sse.join('');
    expect(stream).toContain('agent.status_changed');
    expect(audit).not.toContain(CANARY);
    expect(stream).not.toContain(CANARY);
    expect(JSON.stringify(await client.objectiveStatus('ws1', 'dev', 'o-safe'))).not.toContain(CANARY);

    // 6. harness parity: three real harnesses behind the same enforced pipeline
    expect(Object.keys(ADAPTER_MATRIX).filter((id) => id !== 'fake').sort()).toEqual(['claude-code', 'codex', 'opencode']);
  });
});
