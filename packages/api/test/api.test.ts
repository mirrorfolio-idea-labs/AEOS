import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CredentialProfileSchema,
  newEventId,
  type AeosEvent,
  type AgentConfig,
} from '@aeos/contracts';
import { createEventBus, transcriptPath, type EventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents } from '@aeos/provider-core';
import { createApiServer, listenApi, ApiError } from '../src/index.js';

let home: string;
let app: FastifyInstance;
let bus: EventBus;

const credential = CredentialProfileSchema.parse({
  id: 'cp-default',
  kind: 'api-key',
  secretRef: 'anthropic/main',
});

function makeApp(token?: string): Promise<FastifyInstance> {
  bus = createEventBus();
  return createApiServer({
    home,
    adapterFor: (_agent: AgentConfig) =>
      new FakeAdapter({
        providerSessionId: 'ses_api',
        events: buildFixtureEvents({ profileId: 'cp-default' }),
      }),
    credentialFor: () => credential,
    bus,
    ...(token === undefined ? {} : { token }),
  });
}

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-api-'));
  app = await makeApp();
});

afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

const post = (url: string, body: unknown) =>
  app.inject({ method: 'POST', url, payload: body as Record<string, unknown> });

async function createFixtures(): Promise<void> {
  await post('/v1/workspaces', { id: 'ws1', name: 'Workspace One' });
  await post('/v1/agents', {
    id: 'agent1',
    workspaceId: 'ws1',
    name: 'Agent One',
    harness: { provider: 'claude-code', featureToggles: {} },
    credentialProfileId: 'cp-default',
  });
}

describe('server skeleton (T1)', () => {
  it('health returns the envelope', async () => {
    const response = await app.inject({ url: '/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { status: 'ok', home },
      error: null,
    });
  });

  it('maps zod errors to 400 envelopes and unknown routes/domain errors cleanly', async () => {
    const bad = await post('/v1/workspaces', { id: '' });
    expect(bad.statusCode).toBe(400);
    const body = bad.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(String(body.error)).toContain('id');

    const missing = await app.inject({ url: '/v1/workspaces/nope' });
    expect(missing.json().success).toBe(false);
  });

  it('emits an OpenAPI 3.1 spec covering the resource routes', async () => {
    await app.ready();
    const spec = app.swagger() as unknown as { openapi: string; paths?: Record<string, unknown> };
    expect(spec.openapi).toBe('3.1.0');
    const paths = Object.keys(spec.paths ?? {});
    for (const expected of [
      '/v1/health',
      '/v1/workspaces',
      '/v1/agents',
      '/v1/agents/{id}/credential-profile',
      '/v1/objectives/{id}/start',
      '/v1/memory/search',
      '/v1/events',
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it('requires a bearer token when configured; refuses non-loopback binds without one', async () => {
    const secured = await makeApp('sekret');
    const denied = await secured.inject({ url: '/v1/health' });
    expect(denied.statusCode).toBe(401);
    const allowed = await secured.inject({
      url: '/v1/health',
      headers: { authorization: 'Bearer sekret' },
    });
    expect(allowed.statusCode).toBe(200);
    await secured.close();

    await expect(listenApi(app, { host: '0.0.0.0', port: 0 })).rejects.toThrow(ApiError);
  });
});

describe('resource routes (T2)', () => {
  it('workspace + agent CRUD round-trips through the registry', async () => {
    await createFixtures();
    const workspaces = await app.inject({ url: '/v1/workspaces' });
    expect(workspaces.json().data).toHaveLength(1);
    const agent = await app.inject({ url: '/v1/agents/agent1?workspaceId=ws1' });
    expect(agent.json().data.name).toBe('Agent One');
  });

  it('credential-profile switch persists on the agent (BYOK on the go)', async () => {
    await createFixtures();
    const switched = await post('/v1/agents/agent1/credential-profile?workspaceId=ws1', {
      credentialProfileId: 'cp-client-acme',
    });
    expect(switched.json().data.credentialProfileId).toBe('cp-client-acme');
    const readBack = await app.inject({ url: '/v1/agents/agent1?workspaceId=ws1' });
    expect(readBack.json().data.credentialProfileId).toBe('cp-client-acme');
  });

  it('objective create → start → status completes on provider-fake', async () => {
    await createFixtures();
    const created = await post('/v1/objectives', {
      workspaceId: 'ws1',
      agentId: 'agent1',
      id: 'obj1',
      title: 'Demo objective',
      tasks: [
        { id: 'T1', title: 'first' },
        { id: 'T2', title: 'second' },
      ],
    });
    expect(created.statusCode).toBe(201);
    const started = await post('/v1/objectives/obj1/start?workspaceId=ws1&agentId=agent1', {});
    expect(started.json().data.started).toBe(true);

    let status: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      const response = await app.inject({
        url: '/v1/objectives/obj1?workspaceId=ws1&agentId=agent1',
      });
      status = response.json().data;
      const tasks = status['tasks'] as Array<{ status: string }>;
      if (tasks.every((t) => t.status === 'completed')) break;
      await delay(20);
    }
    const tasks = status['tasks'] as Array<{ status: string }>;
    expect(tasks.map((t) => t.status)).toEqual(['completed', 'completed']);
    const checkpoints = status['checkpoints'] as Array<{ taskId: string; status: string }>;
    expect(checkpoints).toHaveLength(2);
  });

  it('memory index/file/search work over a lazily-initialized tree', async () => {
    await createFixtures();
    const index = await app.inject({ url: '/v1/memory/index?workspaceId=ws1&agentId=agent1' });
    expect(index.json().data.budgets.identity).toBeGreaterThan(0);

    const escape = await app.inject({
      url: '/v1/memory/file?workspaceId=ws1&agentId=agent1&path=../../agent.yaml',
    });
    expect(escape.statusCode).toBe(400);
  });
});

describe('SSE events (T3)', () => {
  const mkEvent = (sessionId: string): AeosEvent => ({
    v: 1,
    id: newEventId(),
    ts: new Date().toISOString(),
    source: 'test',
    agentId: 'agent1',
    sessionId,
    type: 'session.created',
    payload: {},
  });

  it('reconnect with Last-Event-ID replays only the missed suffix, exactly once', async () => {
    await createFixtures();
    const events = [mkEvent('s1'), mkEvent('s1'), mkEvent('s1')];
    const transcript = transcriptPath(home, 'ws1', 'agent1', 's1');
    await mkdir(path.dirname(transcript), { recursive: true });
    await writeFile(transcript, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const address = await listenApi(app, { port: 0 });
    const controller = new AbortController();
    const response = await fetch(
      `${address}/v1/events?workspaceId=ws1&agentId=agent1&sessionId=s1`,
      {
        headers: { 'Last-Event-ID': events[0]?.id as string },
        signal: controller.signal,
      },
    );
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    let buffer = '';
    const liveEvent = mkEvent('s1');
    setTimeout(() => bus.publish(liveEvent), 50);
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const { value } = await Promise.race([
        reader.read(),
        delay(200).then(() => ({ value: undefined })),
      ]);
      if (value) buffer += Buffer.from(value).toString('utf8');
      const got = [...buffer.matchAll(/^id: (.+)$/gm)].map((m) => m[1]);
      if (got.length >= 3) break;
    }
    controller.abort();

    const ids = [...buffer.matchAll(/^id: (.+)$/gm)].map((m) => m[1]);
    // missed suffix (events 2 and 3) + the live event — and NOT event 1
    expect(ids).toEqual([events[1]?.id, events[2]?.id, liveEvent.id]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
