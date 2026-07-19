import { describe, expect, it } from 'vitest';
import { AgentConfigSchema } from '@aeos/contracts';
import { describeAdapterConformance } from '../src/conformance.js';
import { FakeAdapter, buildFixtureEvents } from '../src/provider-fake.js';

const agent = AgentConfigSchema.parse({
  id: 'fake-agent',
  workspaceId: 'fake-ws',
  name: 'Fake Agent',
  harness: { provider: 'claude-code', featureToggles: {} },
  credentialProfileId: 'cp-default',
});

const PROVIDER_SESSION_ID = 'fake-provider-session-001';

function makeAdapter() {
  return new FakeAdapter({
    providerSessionId: PROVIDER_SESSION_ID,
    events: buildFixtureEvents({ profileId: 'cp-default' }),
  });
}

describeAdapterConformance('provider-fake', {
  makeAdapter,
  agent,
  rawCorpus: buildFixtureEvents({ profileId: 'cp-default' }),
});

describe('FakeAdapter specifics', () => {
  it('replays the fixture in order and stamps the AEOS session id', async () => {
    const adapter = makeAdapter();
    const profile = await adapter.createProfile(agent);
    const handle = adapter.spawn({ profile, sessionId: 'sess-01', objective: 'demo' });
    const seen: string[] = [];
    for await (const event of handle.events) {
      seen.push(event.type);
      expect(event.sessionId).toBe('sess-01');
    }
    expect(seen).toEqual([
      'session.created',
      'turn.started',
      'item.message',
      'item.tool_call',
      'item.tool_result',
      'turn.completed',
      'cost.usage',
      'session.completed',
    ]);
  });

  it('captures providerSessionId and costUsd from the stream', async () => {
    const adapter = makeAdapter();
    const profile = await adapter.createProfile(agent);
    const handle = adapter.spawn({ profile, sessionId: 'sess-02', objective: 'demo' });
    for await (const _ of handle.events) {
      // drain
    }
    expect(handle.providerSessionId).toBe(PROVIDER_SESSION_ID);
    expect(handle.costUsd).toBeGreaterThan(0);
    expect(handle.resumeToken).toBe(PROVIDER_SESSION_ID);
  });

  it('exit behavior "fail" ends the stream with session.failed', async () => {
    const adapter = new FakeAdapter({
      providerSessionId: PROVIDER_SESSION_ID,
      events: buildFixtureEvents({ profileId: 'cp-default' }),
      exit: 'fail',
      failureReason: 'simulated crash',
    });
    const profile = await adapter.createProfile(agent);
    const handle = adapter.spawn({ profile, sessionId: 'sess-03', objective: 'demo' });
    const types: string[] = [];
    for await (const event of handle.events) types.push(event.type);
    expect(types.at(-1)).toBe('session.failed');
    expect(types).not.toContain('session.completed');
  });

  it('kill() truncates the replay', async () => {
    const adapter = new FakeAdapter({
      providerSessionId: PROVIDER_SESSION_ID,
      events: buildFixtureEvents({ profileId: 'cp-default' }),
      paceMs: 5,
    });
    const profile = await adapter.createProfile(agent);
    const handle = adapter.spawn({ profile, sessionId: 'sess-04', objective: 'demo' });
    const types: string[] = [];
    for await (const event of handle.events) {
      types.push(event.type);
      if (types.length === 2) handle.kill();
    }
    expect(types.length).toBeLessThan(8);
  });

  it('translate() validates canonical events and skips unknown input', () => {
    const adapter = makeAdapter();
    const [first] = buildFixtureEvents({ profileId: 'cp-default' });
    expect(adapter.translate(first)).toHaveLength(1);
    expect(adapter.translate({ garbage: true })).toHaveLength(0);
    expect(adapter.translate('not even an object')).toHaveLength(0);
  });
});
