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
  type CredentialProfile,
} from '@aeos/contracts';
import { ClaudeAdapter } from '../src/adapter.js';
import { buildResumeSpawn } from '../src/resume.js';
import type { SecretResolver } from '../src/profile.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const agent = AgentConfigSchema.parse({
  id: 'resume-agent',
  workspaceId: 'ws-1',
  name: 'Resume Agent',
  harness: { provider: 'claude-code', featureToggles: {} },
  credentialProfileId: 'cp-main',
});

const mainCredential = CredentialProfileSchema.parse({
  id: 'cp-main',
  kind: 'api-key',
  secretRef: 'anthropic/main',
});

const fallbackCredential = CredentialProfileSchema.parse({
  id: 'cp-fallback',
  kind: 'gateway',
  baseUrl: 'https://gw.example.com',
  secretRef: 'gateway/token',
});

const secrets: SecretResolver = { resolve: (ref) => Promise.resolve(`resolved:${ref}`) };

async function drain(events: AsyncIterable<AeosEvent>): Promise<AeosEvent[]> {
  const all: AeosEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

describe('resume + credential-profile switching', () => {
  it('the same objective continues across a profile switch, cost flipping to the new profile', async () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'aeos-resume-'));
    // Mutable credential + fixture holders simulate the daemon switching
    // profiles between spawns of the same objective.
    let activeCredential: CredentialProfile = mainCredential;
    let activeFixture = 'basic-session.ndjson';
    const adapter = new ClaudeAdapter({
      agentDir: () => path.join(scratch, agent.id),
      credential: () => activeCredential,
      secrets,
      runChild: async function* (_profile, _argv, signal) {
        const raw = await readFile(path.join(fixturesDir, activeFixture), 'utf8');
        for (const line of raw.split('\n').filter((l) => l.trim())) {
          if (signal.aborted) return;
          yield line;
        }
      },
    });

    // Run A on the main credential profile.
    const profileA = await adapter.createProfile(agent);
    const handleA = adapter.spawn({
      profile: profileA,
      sessionId: 'aeos-sess-a',
      objective: 'summarize the repo',
    });
    const eventsA = await drain(handleA.events);
    const costA = eventsA.find((e) => e.type === 'cost.usage');
    expect(costA?.type === 'cost.usage' && costA.payload.profileId).toBe('cp-main');
    expect(handleA.resumeToken).toBe('prov-sess-basic');

    // Switch credential profile + rebuild — takes effect on next spawn only.
    activeCredential = fallbackCredential;
    activeFixture = 'continuation-session.ndjson';
    const profileB = await adapter.createProfile(agent);
    expect(profileB.env['ANTHROPIC_AUTH_TOKEN']).toBe('resolved:gateway/token');
    expect(profileB.env['ANTHROPIC_API_KEY']).toBeUndefined();

    // Run B resumes the SAME provider session with the new profile.
    const spawnB = buildResumeSpawn({
      profile: profileB,
      sessionId: 'aeos-sess-b',
      objective: 'summarize the repo',
      resumeToken: handleA.resumeToken as string,
    });
    const handleB = adapter.spawn(spawnB);
    const eventsB = await drain(handleB.events);

    // Resume token honored: argv carried --resume and the provider kept its session id.
    expect(adapter.buildArgv(spawnB).slice(-2)).toEqual(['--resume', 'prov-sess-basic']);
    expect(handleB.providerSessionId).toBe('prov-sess-basic');
    // The objective's continuation actually happened (references run A's findings).
    const resumedText = eventsB.find((e) => e.type === 'item.message');
    expect(resumedText?.type === 'item.message' && resumedText.payload.text).toContain('Resuming');
    expect(eventsB.at(-1)?.type).toBe('session.completed');
    // Cost events flipped to the new credential profile.
    const costB = eventsB.find((e) => e.type === 'cost.usage');
    expect(costB?.type === 'cost.usage' && costB.payload.profileId).toBe('cp-fallback');
  });

  it('rejects an empty resume token', () => {
    expect(() =>
      buildResumeSpawn({
        profile: { rootDir: '/x', env: {}, argv: [] },
        sessionId: 's',
        objective: 'o',
        resumeToken: '  ',
      }),
    ).toThrow(/non-empty/);
  });
});
