import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CredentialProfileSchema, type AeosEvent } from '@aeos/contracts';
import { createEventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents } from '@aeos/provider-core';
import { createApprovalsRegistry, loadPolicyStack, type ApprovalsRegistry } from '@aeos/policy';
import { PLANNING_MARKER } from '@aeos/scheduler';
import { createApiServer } from '../src/index.js';

let home: string;
let app: FastifyInstance;
let approvals: ApprovalsRegistry;
const events: AeosEvent[] = [];
const prompts: string[] = [];

const PLAN = '- [ ] **T1** [architect] Design it\n- [ ] **T2** [implement] Build it';

async function makeApp(policyYaml: string | undefined): Promise<void> {
  if (policyYaml !== undefined) {
    await mkdir(path.join(home, 'workspaces', 'ws'), { recursive: true });
    await writeFile(path.join(home, 'workspaces', 'ws', 'policy.yaml'), policyYaml);
  }
  const bus = createEventBus();
  bus.subscribe({}, (e) => events.push(e));
  approvals = createApprovalsRegistry({ defaultTimeoutMs: 30_000 });
  app = await createApiServer({
    home,
    adapterFor: () =>
      new FakeAdapter({
        providerSessionId: 'ses',
        events: buildFixtureEvents({ profileId: 'cp' }),
        respond: (prompt) => {
          prompts.push(prompt);
          return prompt.startsWith(PLANNING_MARKER) ? PLAN : undefined;
        },
      }),
    credentialFor: () => CredentialProfileSchema.parse({ id: 'cp', kind: 'api-key', secretRef: 'x' }),
    bus,
    approvals,
    policyFor: (agent) => loadPolicyStack({ home, workspaceId: agent.workspaceId, agentId: agent.id }),
    notify: false,
  });
  await app.inject({ method: 'POST', url: '/v1/workspaces', payload: { id: 'ws', name: 'W' } });
  await app.inject({
    method: 'POST',
    url: '/v1/agents',
    payload: { id: 'dev', workspaceId: 'ws', name: 'Dev', harness: { provider: 'claude-code', featureToggles: {} }, credentialProfileId: 'cp' },
  });
  await app.inject({
    method: 'POST',
    url: '/v1/objectives',
    payload: { workspaceId: 'ws', agentId: 'dev', id: 'obj', title: 'Ship export', definitionOfDone: 'works', autoPlan: true },
  });
}

const status = async () => (await app.inject({ url: '/v1/objectives/obj?workspaceId=ws&agentId=dev' })).json().data;
const start = () => app.inject({ method: 'POST', url: '/v1/objectives/obj/start?workspaceId=ws&agentId=dev' });
const objDir = () => path.join(home, 'workspaces', 'ws', 'agents', 'dev', 'objectives', 'obj');

async function until(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await delay(20);
  }
}

beforeEach(async () => {
  events.length = 0;
  prompts.length = 0;
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-plan-'));
});
afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

describe('objective → plan with policy-gated approval (P3.M1.T2)', () => {
  it('rejects an objective with neither tasks nor autoPlan', async () => {
    await makeApp(undefined);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/objectives',
      payload: { workspaceId: 'ws', agentId: 'dev', id: 'x', title: 'x' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('default posture (run_plan: confirm): the proposed plan waits in the inbox, approval runs it', async () => {
    await makeApp('tiers:\n  execute_commands: allow\n');
    await start();
    await until(async () => approvals.pending().length > 0);
    const [pending] = approvals.pending();
    expect(pending).toMatchObject({ tier: 'run_plan' });
    expect(pending?.detail).toContain('T1 [architect] Design it');
    expect((await status()).proposedTasks.map((t: { taskClass: string }) => t.taskClass)).toEqual(['architect', 'implement']);
    expect((await status()).tasks).toEqual([]); // nothing executes before approval
    expect(prompts[0]).toContain('Objective: Ship export');
    expect(prompts[0]).toContain('Definition of done: works');

    approvals.resolve(pending!.requestId, 'approve', 'kabeer');
    await until(async () => {
      const s = await status();
      return !s.running && s.tasks.length === 2 && s.tasks.every((t: { status: string }) => t.status === 'completed');
    });
    expect(existsSync(path.join(objDir(), 'plan.proposed.md'))).toBe(false);
    const plan = await readFile(path.join(objDir(), 'plan.md'), 'utf8');
    expect(plan).toContain('- [x] **T1** [architect] Design it');
    // executed sessions got the task (not the planning prompt)
    expect(prompts.slice(1).map((p) => p.split('\n')[0])).toEqual(['Design it', 'Build it']);
    const types = events.map((e) => e.type);
    expect(types).toContain('approval.request');
    expect(types).toContain('approval.resolved');
  });

  it('run_plan: allow auto-runs; deny keeps it proposal-only until a human approves', async () => {
    await makeApp('tiers:\n  execute_commands: allow\n  run_plan: deny\n');
    await start();
    await until(async () => existsSync(path.join(objDir(), 'plan.proposed.md')) && !(await status()).running);
    expect((await status()).tasks).toEqual([]);
    expect(approvals.pending()).toHaveLength(0);

    const approved = await app.inject({ method: 'POST', url: '/v1/objectives/obj/plan/approve?workspaceId=ws&agentId=dev' });
    expect(approved.json().data.approved).toBe(true);
    await until(async () => {
      const s = await status();
      return !s.running && s.tasks.length === 2 && s.tasks.every((t: { status: string }) => t.status === 'completed');
    });
  });

  it('planning is read-only: under the DEFAULT posture the planner never parks on a tool approval', async () => {
    await makeApp(undefined); // no policy layers at all
    await start();
    await until(async () => approvals.pending().length > 0);
    // the only pending request is the plan itself — the planner's bash call was denied, not parked
    expect(approvals.pending().map((p) => p.tier)).toEqual(['run_plan']);
    expect(events.some((e) => e.type === 'policy.blocked')).toBe(true);
    approvals.resolve(approvals.pending()[0]!.requestId, 'deny', 'kabeer');
    await until(async () => !(await status()).running);
    expect((await status()).proposedTasks).toHaveLength(2);
  });

  it('allow runs the generated plan unattended', async () => {
    await makeApp('tiers:\n  execute_commands: allow\n  run_plan: allow\n');
    await start();
    await until(async () => {
      const s = await status();
      return !s.running && s.tasks.length === 2 && s.tasks.every((t: { status: string }) => t.status === 'completed');
    });
    expect(approvals.pending()).toHaveLength(0);
  });
});
