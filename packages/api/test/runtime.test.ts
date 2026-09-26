import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CredentialProfileSchema, type AeosEvent } from '@aeos/contracts';
import { createEventBus, type EventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents } from '@aeos/provider-core';
import { createApprovalsRegistry, loadPolicyStack } from '@aeos/policy';
import {
  AgentStatusTracker,
  createApiServer,
  inboxItem,
  renderNotification,
  sortInbox,
  type AgentStatusEntry,
} from '../src/index.js';

let home: string;
let app: FastifyInstance;
let bus: EventBus;
const posted: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
const busEvents: AeosEvent[] = [];

async function makeApp(withPolicy: boolean): Promise<void> {
  bus = createEventBus();
  bus.subscribe({}, (e) => busEvents.push(e));
  const approvals = createApprovalsRegistry({ defaultTimeoutMs: 30_000 });
  app = await createApiServer({
    home,
    adapterFor: () =>
      new FakeAdapter({ providerSessionId: 'ses_rt', events: buildFixtureEvents({ profileId: 'cp' }), paceMs: 5 }),
    credentialFor: () => CredentialProfileSchema.parse({ id: 'cp', kind: 'api-key', secretRef: 'x' }),
    bus,
    ...(withPolicy
      ? {
          approvals,
          policyFor: (agent) => loadPolicyStack({ home, workspaceId: agent.workspaceId, agentId: agent.id }),
        }
      : {}),
    notify: {
      fetchImpl: (async (url: string, init: RequestInit) => {
        posted.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
        return new Response('ok');
      }) as typeof fetch,
    },
  });
  await app.inject({ method: 'POST', url: '/v1/workspaces', payload: { id: 'ws', name: 'W' } });
  for (const id of ['alpha', 'beta']) {
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      payload: { id, workspaceId: 'ws', name: id.toUpperCase(), harness: { provider: 'claude-code', featureToggles: {} }, credentialProfileId: 'cp' },
    });
  }
}

const run = async (agentId: string, objectiveId: string): Promise<void> => {
  await app.inject({
    method: 'POST',
    url: '/v1/objectives',
    payload: { workspaceId: 'ws', agentId, id: objectiveId, title: objectiveId, tasks: [{ id: 'T1', title: 'go' }] },
  });
  await app.inject({ method: 'POST', url: `/v1/objectives/${objectiveId}/start?workspaceId=ws&agentId=${agentId}` });
};

beforeEach(async () => {
  posted.length = 0;
  busEvents.length = 0;
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-rt-'));
});
afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

describe('agent status + wait (P2.M10.T1/T2)', () => {
  it('a run goes working → done, publishes agent.status_changed, and wait resolves', async () => {
    await makeApp(false);
    const before = (await app.inject({ url: '/v1/agents/alpha/status?workspaceId=ws' })).json().data;
    expect(before).toMatchObject({ status: 'idle', seq: 0 });

    const waiting = app.inject({ url: `/v1/agents/alpha/wait?workspaceId=ws&until=done&afterSeq=${String(before.seq)}&timeoutMs=10000` });
    await run('alpha', 'o1');
    const waited = (await waiting).json().data;
    expect(waited.matched).toBe(true);
    expect(waited.entry).toMatchObject({ status: 'done', reason: 'objective o1 completed' });

    const changes = busEvents.filter((e) => e.type === 'agent.status_changed');
    expect(changes.map((e) => (e.payload as { status: string }).status)).toEqual(['working', 'done']);
    expect(changes.every((e) => e.agentId === 'alpha')).toBe(true);
  });

  it('wait times out cleanly with matched=false', async () => {
    await makeApp(false);
    const res = (await app.inject({ url: '/v1/agents/beta/wait?workspaceId=ws&until=blocked&timeoutMs=50' })).json().data;
    expect(res).toMatchObject({ matched: false, entry: { status: 'idle' } });
  });

  it('a default-posture approval makes the agent blocked, and pushes a notification', async () => {
    await writeFile(
      path.join(home, 'notifications.yaml'),
      'webhooks:\n  - url: https://ntfy.example/aeos\n    format: ntfy\n    on: [blocked]\n',
    );
    await makeApp(true);
    await run('alpha', 'o2');
    const waited = (await app.inject({ url: '/v1/agents/alpha/wait?workspaceId=ws&until=blocked&timeoutMs=10000' })).json().data;
    expect(waited.matched).toBe(true);
    expect(waited.entry.reason).toMatch(/^approval requested: /);
    for (let i = 0; i < 50 && posted.length === 0; i += 1) await delay(10);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe('https://ntfy.example/aeos');
    expect(posted[0]?.headers['Title']).toBe('alpha needs you');
    expect(posted[0]?.headers['Priority']).toBe('high');
  });
});

describe('inbox triage (P2.M10.T3)', () => {
  it('orders by attention and supports seen / unread / settle, with new activity un-settling', async () => {
    await makeApp(false);
    await run('alpha', 'o1');
    await app.inject({ url: '/v1/agents/alpha/wait?workspaceId=ws&until=done&afterSeq=0&timeoutMs=10000' });

    let inbox = (await app.inject({ url: '/v1/inbox' })).json().data;
    expect(inbox.map((i: { agentId: string; bucket: number; unseen: boolean }) => [i.agentId, i.bucket, i.unseen])).toEqual([
      ['alpha', 1, true],
      ['beta', 3, false],
    ]);

    const seen = await app.inject({ method: 'POST', url: '/v1/agents/alpha/attention?workspaceId=ws', payload: { action: 'seen' } });
    expect(seen.json().data).toMatchObject({ unseen: false, bucket: 3 });
    const unread = await app.inject({ method: 'POST', url: '/v1/agents/alpha/attention?workspaceId=ws', payload: { action: 'unread' } });
    expect(unread.json().data).toMatchObject({ unseen: true, bucket: 1 });
    const settled = await app.inject({ method: 'POST', url: '/v1/agents/alpha/attention?workspaceId=ws', payload: { action: 'settle' } });
    expect(settled.json().data).toMatchObject({ settled: true, bucket: 4 });

    inbox = (await app.inject({ url: '/v1/inbox' })).json().data;
    expect(inbox.map((i: { agentId: string }) => i.agentId)).toEqual(['beta', 'alpha']);

    // new activity lifts the settle automatically
    await run('alpha', 'o2');
    await app.inject({ url: '/v1/agents/alpha/wait?workspaceId=ws&until=done&afterSeq=2&timeoutMs=10000' });
    inbox = (await app.inject({ url: '/v1/inbox' })).json().data;
    expect(inbox[0]).toMatchObject({ agentId: 'alpha', settled: false, unseen: true, bucket: 1 });
  });

  it('sortInbox: blocked → finished-unseen → working → idle → settled, newest first within a bucket', () => {
    const entry = (agentId: string, status: AgentStatusEntry['status'], seq: number, since: string): AgentStatusEntry => ({
      workspaceId: 'ws',
      agentId,
      status,
      seq,
      since,
      via: 'events',
    });
    const items = [
      inboxItem(entry('idle1', 'idle', 0, '2026-01-01T00:00:00Z'), { seenSeq: 0 }, 'i'),
      inboxItem(entry('settled', 'blocked', 4, '2026-01-01T00:00:09Z'), { seenSeq: 4, settledSeq: 4 }, 's'),
      inboxItem(entry('work', 'working', 2, '2026-01-01T00:00:05Z'), { seenSeq: 0 }, 'w'),
      inboxItem(entry('doneA', 'done', 3, '2026-01-01T00:00:03Z'), { seenSeq: 0 }, 'a'),
      inboxItem(entry('doneB', 'done', 3, '2026-01-01T00:00:04Z'), { seenSeq: 0 }, 'b'),
      inboxItem(entry('stuck', 'blocked', 5, '2026-01-01T00:00:01Z'), { seenSeq: 0 }, 'x'),
    ];
    expect(sortInbox(items).map((i) => i.agentId)).toEqual(['stuck', 'doneB', 'doneA', 'work', 'idle1', 'settled']);
  });
});

describe('status persistence + notification rendering', () => {
  it('seq survives a restart; a stale working status reads as idle', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'aeos-rt-'));
    app = await createApiServer({
      home,
      adapterFor: () => new FakeAdapter({ providerSessionId: 'x', events: [] }),
      credentialFor: () => CredentialProfileSchema.parse({ id: 'cp', kind: 'api-key', secretRef: 'x' }),
      notify: false,
    });
    await app.inject({ method: 'POST', url: '/v1/workspaces', payload: { id: 'ws', name: 'W' } });
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      payload: { id: 'alpha', workspaceId: 'ws', name: 'A', harness: { provider: 'claude-code', featureToggles: {} }, credentialProfileId: 'cp' },
    });
    const first = new AgentStatusTracker(home);
    first.set({ workspaceId: 'ws', id: 'alpha' }, 'working', { via: 'events' });
    first.set({ workspaceId: 'ws', id: 'alpha' }, 'blocked', { via: 'screen', rule: 'bash_permission_prompt' });
    first.set({ workspaceId: 'ws', id: 'alpha' }, 'working', { via: 'events' });
    const restarted = new AgentStatusTracker(home).get({ workspaceId: 'ws', id: 'alpha' });
    expect(restarted).toMatchObject({ status: 'idle', seq: 3, reason: 'daemon restarted mid-session' });
  });

  it('renders json, ntfy and slack payloads', () => {
    const entry: AgentStatusEntry = {
      workspaceId: 'ws',
      agentId: 'alpha',
      status: 'done',
      seq: 2,
      since: '2026-01-01T00:00:00Z',
      via: 'events',
      reason: 'objective o1 completed',
    };
    expect(JSON.parse(renderNotification('json', entry).body)).toMatchObject({ event: 'agent.status_changed', agentId: 'alpha' });
    expect(renderNotification('ntfy', entry).headers).toMatchObject({ Title: 'alpha finished', Tags: 'white_check_mark' });
    expect(JSON.parse(renderNotification('slack', entry).body).text).toContain('*alpha finished*');
  });
});
