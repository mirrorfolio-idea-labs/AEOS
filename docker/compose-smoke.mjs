#!/usr/bin/env node
// Compose quickstart smoke (P4.M3.T2 accept; also T3's "unauthenticated
// non-loopback request rejected"). Run after `docker compose up -d` with
// AEOS_PROVIDER=fake:  node docker/compose-smoke.mjs [baseUrl] [tokenFile]
import { readFileSync } from 'node:fs';
import { AeosClient } from '../packages/sdk/dist/index.js';

const base = process.argv[2] ?? 'http://127.0.0.1:7777';
const token = readFileSync(process.argv[3] ?? 'secrets/aeos_api_token', 'utf8').trim();
const step = (msg) => console.log(`compose-smoke: ${msg}`);
const fail = (msg) => {
  console.error(`compose-smoke: FAIL — ${msg}`);
  process.exit(1);
};

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/healthz`)).ok) break;
  } catch {}
  if (i > 120) fail('daemon never became healthy');
  await new Promise((r) => setTimeout(r, 1000));
}
step('healthy');

// the request reaches aeosd over the docker bridge — non-loopback from its side
const anon = await fetch(`${base}/v1/workspaces`);
if (anon.status !== 401) fail(`unauthenticated /v1 request got ${anon.status}, expected 401`);
const wrong = await fetch(`${base}/v1/workspaces`, { headers: { authorization: 'Bearer nope' } });
if (wrong.status !== 401) fail(`wrong token got ${wrong.status}, expected 401`);
step('unauthenticated and wrong-token requests rejected (401)');
if (!(await fetch(`${base}/`)).ok) fail('the ADE web UI is not served');
step('web UI served');

const client = new AeosClient({ baseUrl: base, token });
await client.createWorkspace({ id: 'quickstart', name: 'Quickstart' });
await client.createAgent({
  id: 'dev',
  workspaceId: 'quickstart',
  name: 'Dev',
  harness: { provider: 'claude-code', featureToggles: { plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false } },
  credentialProfileId: 'cp',
});
// quickstart posture: the fake provider's tool call runs without parking
await client.createObjective({ workspaceId: 'quickstart', agentId: 'dev', id: 'hello', title: 'Hello AEOS', tasks: [{ id: 'T1', title: 'say hello' }] });
const approvals = setInterval(async () => {
  for (const a of await client.listApprovals().catch(() => [])) await client.resolveApproval(a.requestId, 'approve').catch(() => {});
}, 200);
await client.startObjective('quickstart', 'dev', 'hello');
let status;
for (let i = 0; i < 300; i++) {
  status = await client.objectiveStatus('quickstart', 'dev', 'hello');
  if (!status.running && status.tasks.every((t) => t.status === 'completed')) break;
  await new Promise((r) => setTimeout(r, 200));
}
clearInterval(approvals);
if (!status.tasks.every((t) => t.status === 'completed')) fail(`objective did not complete: ${JSON.stringify(status.tasks)}`);
step('objective completed through the authenticated API');
console.log('compose-smoke: PASS');
