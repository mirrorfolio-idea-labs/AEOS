import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AgentConfigSchema,
  CredentialProfileSchema,
  type AeosEvent,
  type AgentConfig,
} from '@aeos/contracts';
import { type HarnessProfile } from '@aeos/provider-core';
import { describeAdapterConformance } from '@aeos/provider-core/conformance';
import { OpencodeAdapter } from '../src/adapter.js';
import type { SecretResolver } from '../src/profile.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixtureLines = (name: string) =>
  readFile(path.join(fixturesDir, name), 'utf8').then((s) =>
    s.split('\n').filter((l) => l.trim().length > 0),
  );

const agent: AgentConfig = AgentConfigSchema.parse({
  id: 'oc-agent',
  workspaceId: 'ws-1',
  name: 'OpenCode Agent',
  harness: { provider: 'opencode', featureToggles: {} },
  credentialProfileId: 'cp-1',
});

const credential = CredentialProfileSchema.parse({
  id: 'cp-1',
  kind: 'api-key',
  secretRef: 'anthropic/main',
});

const secrets: SecretResolver = { resolve: (ref) => Promise.resolve(`resolved:${ref}`) };

const scratch = mkdtempSync(path.join(os.tmpdir(), 'aeos-oc-adapter-'));

function makeAdapter(fixture = 'basic-session.ndjson'): OpencodeAdapter {
  return new OpencodeAdapter({
    agentDir: (a) => path.join(scratch, a.id),
    credential: () => credential,
    secrets,
    runChild: async function* (_profile, _argv, signal) {
      for (const line of await fixtureLines(fixture)) {
        if (signal.aborted) return;
        yield line;
      }
    },
  });
}

describeAdapterConformance('opencode (fixture-driven)', {
  makeAdapter,
  agent,
  rawCorpus: JSON.parse(
    '[' + (await fixtureLines('basic-session.ndjson')).join(',') + ']',
  ) as unknown[],
});

describe('OpencodeAdapter specifics', () => {
  const dummyProfile: HarnessProfile = {
    rootDir: '/tmp/x',
    env: { AEOS_CREDENTIAL_PROFILE_ID: 'cp-1' },
    argv: [],
  };

  it('builds the documented run argv and appends --session when resuming', () => {
    const fresh = makeAdapter().buildArgv({
      profile: dummyProfile,
      sessionId: 's',
      objective: 'do the thing',
    });
    expect(fresh).toEqual(['opencode', 'run', 'do the thing', '--format', 'json']);
    const resumed = makeAdapter().buildArgv({
      profile: dummyProfile,
      sessionId: 's',
      objective: 'continue',
      resumeToken: 'ses_basic01',
    });
    expect(resumed.slice(-2)).toEqual(['--session', 'ses_basic01']);
  });

  it('streams translated events and captures session id + cost', async () => {
    const adapter = makeAdapter();
    const profile = await adapter.createProfile(agent);
    const handle = adapter.spawn({ profile, sessionId: 'sess-live', objective: 'demo' });
    const types: string[] = [];
    for await (const event of handle.events) {
      expect(event.sessionId).toBe('sess-live');
      types.push(event.type);
    }
    expect(types[0]).toBe('session.created');
    expect(types.at(-1)).toBe('session.completed');
    expect(handle.providerSessionId).toBe('ses_basic01');
    expect(handle.resumeToken).toBe('ses_basic01');
    expect(handle.costUsd).toBeCloseTo(0.0098);
  });

  it('resume: the continuation fixture keeps the provider session and finishes the objective', async () => {
    const adapter = makeAdapter('continuation-session.ndjson');
    const profile = await adapter.createProfile(agent);
    const handle = adapter.spawn({
      profile,
      sessionId: 'sess-resumed',
      objective: 'summarize the repo',
      resumeToken: 'ses_basic01',
    });
    const events: AeosEvent[] = [];
    for await (const event of handle.events) events.push(event);
    expect(handle.providerSessionId).toBe('ses_basic01');
    const text = events.find((e) => e.type === 'item.message');
    expect(text?.type === 'item.message' && text.payload.text).toContain('Resuming');
    expect(events.at(-1)?.type).toBe('session.completed');
  });
});
