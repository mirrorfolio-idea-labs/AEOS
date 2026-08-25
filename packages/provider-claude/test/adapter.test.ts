import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AgentConfigSchema,
  CredentialProfileSchema,
  type AgentConfig,
} from '@aeos/contracts';
import { type HarnessProfile } from '@aeos/provider-core';
import { describeAdapterConformance } from '@aeos/provider-core/conformance';
import { ADAPTER_MATRIX } from '@aeos/provider-core';
import { ClaudeAdapter } from '../src/adapter.js';
import type { SecretResolver } from '../src/profile.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixtureLines = (name: string) =>
  readFile(path.join(fixturesDir, name), 'utf8').then((s) =>
    s.split('\n').filter((l) => l.trim().length > 0),
  );

const agent: AgentConfig = AgentConfigSchema.parse({
  id: 'claude-agent',
  workspaceId: 'ws-1',
  name: 'Claude Agent',
  harness: { provider: 'claude-code', featureToggles: {} },
  credentialProfileId: 'cp-1',
});

const credential = CredentialProfileSchema.parse({
  id: 'cp-1',
  kind: 'api-key',
  secretRef: 'anthropic/main',
});

const secrets: SecretResolver = {
  resolve: (ref) => Promise.resolve(`resolved:${ref}`),
};

const scratch = mkdtempSync(path.join(os.tmpdir(), 'aeos-claude-adapter-'));

function makeAdapter(fixture = 'basic-session.ndjson'): ClaudeAdapter {
  return new ClaudeAdapter({
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

describeAdapterConformance('claude-code (fixture-driven)', {
  capabilityClaims: ADAPTER_MATRIX['claude-code'],
  makeAdapter,
  agent,
  rawCorpus: JSON.parse(
    '[' +
      (await fixtureLines('basic-session.ndjson')).join(',') +
      ']',
  ) as unknown[],
});

describe('ClaudeAdapter specifics', () => {
  const dummyProfile: HarnessProfile = {
    rootDir: '/tmp/x',
    env: { AEOS_CREDENTIAL_PROFILE_ID: 'cp-1' },
    argv: ['--bare', '--settings', '/tmp/x/settings.json'],
  };

  it('builds the documented spawn argv with profile flags appended', () => {
    const argv = makeAdapter().buildArgv({
      profile: dummyProfile,
      sessionId: 's',
      objective: 'do the thing',
    });
    expect(argv.slice(0, 6)).toEqual([
      'claude',
      '-p',
      'do the thing',
      '--output-format',
      'stream-json',
      '--verbose',
    ]);
    expect(argv).toContain('--bare');
    expect(argv).not.toContain('--resume');
  });

  it('appends --resume <token> when resuming', () => {
    const argv = makeAdapter().buildArgv({
      profile: dummyProfile,
      sessionId: 's',
      objective: 'continue',
      resumeToken: 'prov-sess-basic',
    });
    expect(argv.slice(-2)).toEqual(['--resume', 'prov-sess-basic']);
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
    expect(handle.providerSessionId).toBe('prov-sess-basic');
    expect(handle.resumeToken).toBe('prov-sess-basic');
    expect(handle.costUsd).toBeCloseTo(0.0123);
  });

  it('tags cost.usage with the credential profile id from the hermetic profile', async () => {
    const adapter = makeAdapter();
    const profile = await adapter.createProfile(agent);
    const handle = adapter.spawn({ profile, sessionId: 'sess-cost', objective: 'demo' });
    for await (const event of handle.events) {
      if (event.type === 'cost.usage') expect(event.payload.profileId).toBe('cp-1');
    }
  });
});
