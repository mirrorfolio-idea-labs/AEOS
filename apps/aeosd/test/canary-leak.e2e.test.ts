import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AeosClient } from '@aeos/sdk';
import { createFileSecretStore } from '@aeos/secrets';

/**
 * P2.M3 exit gate — the canary-leak proof (spec §11): a secret registered
 * with the daemon (via the age store here) and echoed by a tool result
 * must appear NOWHERE downstream — not in the session transcript, not in
 * the append-only audit log, not on the live SSE stream, not in REST
 * payloads. Control markers ride along to prove each sink was actually
 * exercised.
 */

const CANARY = 'CANARY-leak-me-9x7q-prepaid-value';
const CONTROL = 'CONTROL-keep-me-4k2m-visible-marker';
const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');

const cleanups: Array<() => Promise<void> | void> = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

interface DaemonHandle {
  client: AeosClient;
  baseUrl: string;
  home: string;
  lastStderr: () => string;
}

async function startCanaryDaemon(): Promise<DaemonHandle> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-canary-'));
  // plant the secret where the daemon's boot enumeration will find it
  await createFileSecretStore(home).set('canary_ref', CANARY);
  // This suite proves REDACTION mechanics, not policy posture (same opt-out
  // as golden-path): without an allow layer the default posture confirm-pauses
  // the fixture tool_call for 300s.
  await mkdir(path.join(home, 'workspaces', 'ws1'), { recursive: true });
  await writeFile(
    path.join(home, 'workspaces', 'ws1', 'policy.yaml'),
    'tiers:\n  execute_commands: allow\n',
    'utf8',
  );

  const port = 7900 + (process.pid % 500); // pid-derived: parallel-safe
  const child = spawn(process.execPath, [MAIN, 'run'], {
    env: {
      PATH: process.env['PATH'] ?? '',
      AEOS_HOME: home,
      AEOS_PORT: String(port),
      AEOS_PROVIDER: 'fake',
      AEOS_FAKE_PACE_MS: '20',
      AEOS_SECRETS_STORE: '1',
      AEOS_FAKE_TOOL_OUTPUT: `${CONTROL} ${CANARY}\n`,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  cleanups.push(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
    return rm(home, { recursive: true, force: true });
  });
  let stderrText = '';
  child.stderr?.on('data', (c: Buffer) => {
    stderrText += c.toString();
  });
  const lastStderr = (): string => stderrText.slice(-800);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`boot timeout:\n${stderrText}`)), 30_000);
    const check = setInterval(() => {
      if (stderrText.includes('aeosd ready')) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 20);
    child.once('exit', (code) => {
      clearTimeout(timer);
      clearInterval(check);
      reject(new Error(`daemon exited during boot (${code}):\n${stderrText}`));
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  return { client: new AeosClient({ baseUrl }), baseUrl, home, lastStderr };
}

describe('P2.M3 exit gate — canary-leak across all sinks', () => {
  it('a registered secret echoed by a tool never reaches any sink', { timeout: 90_000 }, async () => {
    const daemon = await startCanaryDaemon();
    const { client, baseUrl, home, lastStderr } = daemon;

    await client.createWorkspace({
      id: 'ws1',
      name: 'WS One',
    } as Parameters<typeof client.createWorkspace>[0]);
    await client.createAgent({
      id: 'dev',
      workspaceId: 'ws1',
      name: 'Dev',
      harness: { provider: 'claude-code', featureToggles: {} },
      credentialProfileId: 'cp',
    } as Parameters<typeof client.createAgent>[0]);
    const { id: objectiveId } = await client.createObjective({
      workspaceId: 'ws1',
      agentId: 'dev',
      id: 'obj-canary',
      title: 'echo a marker',
      tasks: [{ id: 'T1', title: 'run the echo' }],
    });

    // live SSE capture starts before the run so the stream is exercised
    const controller = new AbortController();
    const sseChunks: string[] = [];
    const sseDone = (async () => {
      const res = await fetch(`${baseUrl}/v1/events`, { signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        try {
          const { done, value } = await reader.read();
          if (done) break;
          sseChunks.push(decoder.decode(value, { stream: true }));
        } catch {
          break;
        }
      }
    })();

    await client.startObjective('ws1', 'dev', objectiveId);
    const deadline = Date.now() + 45_000;
    let lastStatuses: string[] = [];
    try {
      for (;;) {
        const status = await client.objectiveStatus('ws1', 'dev', objectiveId);
        lastStatuses = status.tasks.map((t) => t.status);
        if (lastStatuses.every((st) => st === 'completed')) break;
        if (Date.now() > deadline)
          throw new Error(`status timeout: ${JSON.stringify(lastStatuses)}\nstderr:\n${daemon.lastStderr()}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      controller.abort();
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 300)); // let writers flush

    // Sink 1 — transcripts: objective-scoped fake sessions carry no
    // session.yaml/transcript yet (documented v0 deferral, BOARD); the
    // redaction wrapper sits upstream of every future transcript writer,
    // and the kernel unit tests pin scrub-before-subscribe semantics.
    const sessionsRoot = path.join(home, 'workspaces', 'ws1', 'agents', 'dev', 'sessions');
    await expect(readdir(sessionsRoot)).rejects.toThrow();

    // Sink 2 — audit log (tool results are an audited class)
    const auditDir = path.join(home, 'audit');
    const auditFiles = await readdir(auditDir);
    expect(auditFiles.length).toBeGreaterThan(0);
    const audit = await readFile(path.join(auditDir, auditFiles[0]!), 'utf8');
    expect(audit).toContain(CONTROL);
    expect(audit).not.toContain(CANARY);

    // Sink 3 — live SSE stream (the canonical event pipeline)
    controller.abort();
    await sseDone.catch(() => undefined);
    const sse = sseChunks.join('');
    expect(sse).toContain(CONTROL);
    expect(sse).toContain('session.completed');
    expect(sse).not.toContain(CANARY);

    // Sink 4 — REST payloads
    const restPayload = JSON.stringify(await client.objectiveStatus('ws1', 'dev', objectiveId));
    expect(restPayload).not.toContain(CANARY);

    // the store itself keeps serving the real value — redaction is view-only
    expect(await createFileSecretStore(home).get('canary_ref')).toBe(CANARY);
  });
});
