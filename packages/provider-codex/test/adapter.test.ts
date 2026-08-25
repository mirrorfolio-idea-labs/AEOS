import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AgentConfigSchema,
  CredentialProfileSchema,
  type AgentConfig,
} from '@aeos/contracts';
import { describeAdapterConformance } from '@aeos/provider-core/conformance';
import type { HarnessProfile } from '@aeos/provider-core';
import { CodexAdapter, type RunChild } from '../src/adapter.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixtureLines = (name: string) =>
  readFile(path.join(fixturesDir, name), 'utf8').then((s) =>
    s.split('\n').filter((l) => l.trim().length > 0),
  );

const agent: AgentConfig = AgentConfigSchema.parse({
  id: 'cx-agent',
  workspaceId: 'ws-1',
  name: 'Codex Agent',
  harness: { provider: 'codex', featureToggles: {} },
  credentialProfileId: 'cp-1',
});

const credential = CredentialProfileSchema.parse({
  id: 'cp-1',
  kind: 'api-key',
  secretRef: 'openai/main',
});

function makeAdapter(): CodexAdapter {
  return new CodexAdapter({
    agentDir: (a: AgentConfig) => `/tmp/agents/${a.id}`,
    credential: () => credential,
    secrets: { resolve: (ref: string) => Promise.resolve(`resolved:${ref}`) },
    // fixture-driven child: conformance never touches the network or binary
    runChild: async function* (_profile, _argv, signal) {
      for (const line of await fixtureLines('session.ndjson')) {
        if (signal.aborted) return;
        yield line;
      }
    },
  });
}

describeAdapterConformance('codex (fixture-driven)', {
  makeAdapter,
  agent,
  rawCorpus: JSON.parse(
    '[' + (await fixtureLines('session.ndjson')).join(',') + ']',
  ) as unknown[],
});

describe('CodexAdapter specifics', () => {
  it('spawn over the fixture child streams canonical events and ends completed', async () => {
    const profile: HarnessProfile = {
      rootDir: '/tmp/x',
      env: { AEOS_CREDENTIAL_PROFILE_ID: 'cp-1' },
      argv: [],
    };
    const handle = makeAdapter().spawn({
      profile,
      sessionId: 'sess-1',
      objective: 'record a fixture',
    });

    const types: string[] = [];
    for await (const event of handle.events) types.push(event.type);

    expect(types[0]).toBe('session.created');
    expect(types).toContain('item.tool_call');
    expect(types).toContain('item.tool_result');
    expect(types[types.length - 1]).toBe('session.completed');
    expect(handle.providerSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(handle.resumeToken).toBe(handle.providerSessionId);
  });

  it('resume argv targets the recorded thread', () => {
    const adapter = makeAdapter();
    const argv = adapter.buildArgv({
      profile: { rootDir: '/tmp/x', env: {}, argv: [] },
      sessionId: 's',
      objective: 'continue',
      resumeToken: '01ARZ3NDEKTSV4RRFFQ69G5FB9',
    });
    expect(argv).toEqual([
      'codex',
      'exec',
      '--json',
      '--skip-git-repo-check',
      'resume',
      '01ARZ3NDEKTSV4RRFFQ69G5FB9',
      'continue',
    ]);
  });
});
