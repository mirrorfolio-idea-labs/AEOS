// Playwright web server: one process serving the built UI (dist/) and the
// API (provider-fake) on PORT (default 7777). AEOS_HOME is a fresh temp dir.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { createEventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents } from '@aeos/provider-core';
import { createApiServer, listenApi } from '@aeos/api';
import { createApprovalsRegistry, loadPolicyStack } from '@aeos/policy';

let home = process.env.AEOS_HOME;
if (home) {
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
} else {
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-ade-'));
}
const app = await createApiServer({
  home,
  adapterFor: () =>
    new FakeAdapter({
      providerSessionId: 'ses_ade',
      events: buildFixtureEvents({ profileId: 'cp-default' }),
      paceMs: 30,
    }),
  credentialFor: () => ({ id: 'cp-default', kind: 'api-key', secretRef: 'env' }),
  bus: createEventBus(),
  // mirror the daemon (api-module.ts): real default posture + approvals inbox
  approvals: createApprovalsRegistry({ defaultTimeoutMs: 30_000 }),
  policyFor: (agent) => loadPolicyStack({ home, workspaceId: agent.workspaceId, agentId: agent.id }),
  // P2.M5: pipe-backed takeover bridge for UI tests — real PTY mechanics are
  // covered by the runner/supervisor suites; this exercises the WS↔xterm path
  resolveAgent: () => ({
    id: 'backend-dev',
    workspaceId: 'client-acme',
    name: 'Backend Dev',
    harness: { provider: 'claude-code' },
    credentialProfileId: 'cp-default',
  }),
  attachPty: async (_sessionId, onOutput) => {
    const { spawn } = await import('node:child_process');
    const shell = spawn('/bin/bash', ['-i'], { stdio: ['pipe', 'pipe', 'pipe'] });
    shell.stdout.on('data', (chunk) => onOutput(chunk.toString()));
    shell.stderr.on('data', (chunk) => onOutput(chunk.toString()));
    return {
      input: (data) => shell.stdin.write(data),
      resize: () => undefined,
      release: () => shell.kill(),
    };
  },
});
await app.register(fastifyStatic, {
  root: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
});
const address = await listenApi(app, { port: Number(process.env.PORT ?? 7777) });
console.log(`ADE harness on ${address} (home: ${home})`);
