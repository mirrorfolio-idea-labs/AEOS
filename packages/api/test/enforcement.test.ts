import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  AeosEventSchema,
  newEventId,
  CredentialProfileSchema,
  type AeosEvent,
  type AgentConfig,
} from '@aeos/contracts';
import { createEventBus, transcriptPath, type EventBus } from '@aeos/kernel';
import {
  FakeAdapter,
  type CapabilityMatrix,
  type HarnessAdapter,
  type HarnessProfile,
  type SessionHandle,
  type SpawnOptions,
} from '@aeos/provider-core';
import { createApprovalsRegistry } from '@aeos/policy';
import { createApiServer, listenApi } from '../src/server.js';

/**
 * P2.M1.T3 accept criterion: a provider-fake attempting a denied action is
 * blocked EVEN THOUGH the harness-native flags were compiled permissive —
 * defense in depth means the daemon gate does not trust harness flags.
 */

let home: string;
let app: FastifyInstance;
let bus: EventBus;
const seen: AeosEvent[] = [];
let approvals = createApprovalsRegistry();
let lastSpawnOpts: SpawnOptions | undefined;

const credential = CredentialProfileSchema.parse({
  id: 'cp-default',
  kind: 'api-key',
  secretRef: 'anthropic/main',
});

/** Fake whose single task performs a `git push` mid-session. */
function GitPushAdapter(): HarnessAdapter {
  const inner = new FakeAdapter({
    providerSessionId: 'ses_gitpush',
    events: AeosEventSchema.array().parse([
      {
        v: 1,
        id: newEventId(),
        ts: '2026-08-25T00:00:00.000Z',
        source: 'provider-fake',
        type: 'session.created',
        payload: {},
      },
      {
        v: 1,
        id: newEventId(),
        ts: '2026-08-25T00:00:01.000Z',
        source: 'provider-fake',
        type: 'item.tool_call',
        payload: { callId: 'c1', tool: 'Bash', input: { command: 'git push origin main' } },
      },
      {
        v: 1,
        id: newEventId(),
        ts: '2026-08-25T00:00:02.000Z',
        source: 'provider-fake',
        type: 'session.completed',
        payload: {},
      },
    ]),
  });
  return {
    id: inner.id,
    capabilities(): CapabilityMatrix {
      return inner.capabilities();
    },
    createProfile(agent: AgentConfig): Promise<HarnessProfile> {
      return inner.createProfile(agent);
    },
    spawn(opts: SpawnOptions): SessionHandle {
      lastSpawnOpts = opts; // capture what the harness was told
      return inner.spawn(opts);
    },
    translate(raw: unknown) {
      return inner.translate(raw);
    },
  };
}

const post = async (url: string, body?: unknown) =>
  app.inject({ method: 'POST', url, payload: body as Record<string, unknown> });

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200 && !(await predicate()); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(await predicate(), `timed out waiting for ${what}`).toBe(true);
}

async function setup(policyYaml?: string): Promise<string> {
  bus = createEventBus();
  seen.length = 0;
  bus.subscribe({}, (event) => seen.push(event));
  approvals = createApprovalsRegistry({ defaultTimeoutMs: 2_000 });
  lastSpawnOpts = undefined;
  app = await createApiServer({
    home,
    adapterFor: () => GitPushAdapter(),
    credentialFor: () => credential,
    approvals,
    policyFor: async (agent) => {
      const { loadPolicyStack } = await import('@aeos/policy');
      return loadPolicyStack({
        home,
        workspaceId: agent.workspaceId,
        agentId: agent.id,
      });
    },
    bus,
  });
  await post('/v1/workspaces', { id: 'ws1', name: 'W' });
  await post('/v1/agents', {
    id: 'ada',
    workspaceId: 'ws1',
    name: 'Ada',
    harness: { provider: 'claude-code', featureToggles: {} },
    credentialProfileId: 'cp-default',
  });
  if (policyYaml !== undefined) {
    await writeFile(
      path.join(home, 'workspaces', 'ws1', 'agents', 'ada', 'policy.yaml'),
      policyYaml,
    );
  }
  await post('/v1/objectives', {
    workspaceId: 'ws1',
    agentId: 'ada',
    id: 'obj1',
    title: 'Push something',
    tasks: [{ id: 'T1', title: 'Do the push' }],
  });
  return 'obj1';
}

async function runToCompletion(objectiveId: string): Promise<void> {
  const start = await post(`/v1/objectives/${objectiveId}/start?workspaceId=ws1&agentId=ada`);
  expect(start.statusCode).toBe(200);
  await waitFor(async () => {
    const status = await app.inject({
      url: `/v1/objectives/${objectiveId}?workspaceId=ws1&agentId=ada`,
    });
    return status.json().data.running === false;
  }, 'objective run to finish');
}

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-enforce-'));
});

afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

describe('daemon-side enforcement (P2.M1.T3)', () => {
  it('blocks a confirm-tier git push under the DEFAULT posture until denied', async () => {
    const objectiveId = await setup();

    // start; the run must PARK on the approval request
    await post(`/v1/objectives/${objectiveId}/start?workspaceId=ws1&agentId=ada`);
    await waitFor(() => approvals.pending().length === 1, 'pending approval');
    const pending = approvals.pending()[0]!;
    expect(pending.tier).toBe('git_push');

    // inbox endpoint mirrors the registry
    const inbox = await app.inject({ url: '/v1/approvals' });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().data.pending).toHaveLength(1);

    // deny it; the run then completes
    const answer = await post(`/v1/approvals/${pending.requestId}`, { decision: 'deny' });
    expect(answer.statusCode).toBe(200);
    await runToCompletion(objectiveId);

    // the compiled policy reached the adapter…
    expect(lastSpawnOpts?.permissionPolicy?.effective.tiers.git_push).toBe('confirm');
    // …but the fake harness ignores flags by construction (worst case), so
    // what actually stopped the push was THIS process's guard.
    const types = seen.map((e) => e.type);
    expect(types).toContain('approval.request');
    expect(types).toContain('policy.blocked');
    const resolved = seen.find((e) => e.type === 'approval.resolved');
    expect(resolved && resolved.type === 'approval.resolved' && resolved.payload.decision).toBe(
      'denied',
    );
    const results = seen.filter((e) => e.type === 'item.tool_result');
    expect(results.length).toBeGreaterThan(0);
    // the task still completes — a blocked action is not necessarily fatal
    const status = await app.inject({
      url: `/v1/objectives/${objectiveId}?workspaceId=ws1&agentId=ada`,
    });
    expect(status.json().data.tasks[0].status).toBe('completed');
  }, 15_000);

  it('an explicit allow layer lets the identical objective through untouched', async () => {
    const objectiveId = await setup('tiers:\n  git_push: allow\n');
    await runToCompletion(objectiveId);
    expect(seen.map((e) => e.type)).not.toContain('policy.blocked');
    const call = seen.find((e) => e.type === 'item.tool_call');
    expect(call).toBeDefined(); // original call passed through
  }, 15_000);
});
