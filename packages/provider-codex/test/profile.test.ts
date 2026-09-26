import { mkdtempSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentConfigSchema,
  CredentialProfileSchema,
  type AgentConfig,
} from '@aeos/contracts';
import { buildCodexProfile, MissingSubscriptionHomeError, parseGeneratedSidecar } from '../src/profile.js';

const agent: AgentConfig = AgentConfigSchema.parse({
  id: 'cx-agent',
  workspaceId: 'ws-1',
  name: 'Codex Agent',
  harness: { provider: 'codex', featureToggles: {} },
  credentialProfileId: 'cp-1',
});

const secrets = { resolve: (ref: string) => Promise.resolve(`resolved:${ref}`) };

describe('buildCodexProfile (P2.M6.T1)', () => {
  it('creates a CODEX_HOME-hermetic profile with generated config and sidecar', async () => {
    const agentDir = mkdtempSync(path.join(os.tmpdir(), 'aeos-codex-prof-'));
    const profile = await buildCodexProfile({
      agent,
      agentDir,
      credential: CredentialProfileSchema.parse({ id: 'cp-1', kind: 'api-key', secretRef: 'openai/main' }),
      secrets,
    });

    expect(profile.rootDir).toBe(path.join(agentDir, 'harness', 'codex'));
    expect(profile.env['CODEX_HOME']).toBe(profile.rootDir);
    expect(profile.env['OPENAI_API_KEY']).toBe('resolved:openai/main');
    expect(profile.env['AEOS_CREDENTIAL_PROFILE_ID']).toBe('cp-1');

    const toml = await fs.readFile(path.join(profile.rootDir, 'config.toml'), 'utf8');
    expect(toml).toContain('check_updates = false');
    // hermetic: no absolute home references anywhere in the profile
    expect(JSON.stringify(profile)).not.toContain(os.homedir());

    const sidecar = await fs.readFile(path.join(profile.rootDir, '.aeos-generated.json'), 'utf8');
    expect(parseGeneratedSidecar(sidecar).agentId).toBe('cx-agent');
  });

  it('subscription slots map CODEX_HOME to isolated persistent login homes', async () => {
    const homes: Record<string, string> = {
      alice: '/srv/codex-homes/alice',
      bob: '/srv/codex-homes/bob',
    };
    const profiles = await Promise.all(
      Object.entries(homes).map(([slot, home]) =>
        buildCodexProfile({
          agent,
          agentDir: mkdtempSync(path.join(os.tmpdir(), 'aeos-codex-slot-')),
          credential: CredentialProfileSchema.parse({ id: `cp-${slot}`, kind: 'subscription', slot }),
          secrets,
          subscriptionHomeFor: (s) => homes[s]!,
        }),
      ),
    );
    expect(profiles[0]!.env['CODEX_HOME']).toBe('/srv/codex-homes/alice');
    expect(profiles[1]!.env['CODEX_HOME']).toBe('/srv/codex-homes/bob');
  });

  it('subscription without a slot home mapping is a typed error', async () => {
    await expect(
      buildCodexProfile({
        agent,
        agentDir: mkdtempSync(path.join(os.tmpdir(), 'aeos-codex-noslot-')),
        credential: CredentialProfileSchema.parse({ id: 'cp-s', kind: 'subscription', slot: 'alice' }),
        secrets,
      }),
    ).rejects.toThrow(MissingSubscriptionHomeError);
  });
});
