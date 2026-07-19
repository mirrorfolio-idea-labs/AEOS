import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CredentialProfileSchema, newEventId, type AeosEvent } from '@aeos/contracts';
import { createEventBus, type EventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents } from '@aeos/provider-core';
import { createApiServer, listenApi } from '@aeos/api';
import { AeosApiError, AeosClient } from '../src/index.js';

let home: string;
let app: Awaited<ReturnType<typeof createApiServer>>;
let bus: EventBus;
let client: AeosClient;

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-sdk-'));
  bus = createEventBus();
  app = await createApiServer({
    home,
    adapterFor: () =>
      new FakeAdapter({ providerSessionId: 'ses_sdk', events: buildFixtureEvents({ profileId: 'cp' }) }),
    credentialFor: () =>
      CredentialProfileSchema.parse({ id: 'cp', kind: 'api-key', secretRef: 'env' }),
    bus,
  });
  client = new AeosClient({ baseUrl: await listenApi(app, { port: 0 }) });
});

afterAll(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

describe('AeosClient', () => {
  it('unwraps envelopes and throws AeosApiError on failures', async () => {
    expect((await client.health()).status).toBe('ok');
    await expect(client.getAgent('nope', 'missing')).rejects.toThrow(AeosApiError);
  });

  it('streams live SSE events through the fetch-based reader', async () => {
    const controller = new AbortController();
    const received: AeosEvent[] = [];
    const event: AeosEvent = {
      v: 1,
      id: newEventId(),
      ts: new Date().toISOString(),
      source: 'test',
      sessionId: 'sse-1',
      type: 'session.created',
      payload: {},
    };
    const reading = (async () => {
      for await (const e of client.events({ sessionId: 'sse-1', signal: controller.signal })) {
        received.push(e);
        controller.abort();
      }
    })().catch(() => undefined);
    setTimeout(() => bus.publish(event), 100);
    await reading;
    expect(received.map((e) => e.id)).toEqual([event.id]);
  });
});
