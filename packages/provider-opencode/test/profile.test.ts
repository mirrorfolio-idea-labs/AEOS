import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigSchema, CredentialProfileSchema, type AgentConfig } from '@aeos/contracts';
import {
  buildOpencodeProfile,
  MissingSubscriptionHomeError,
  parseGeneratedConfig,
  type SecretResolver,
} from '../src/profile.js';

const stubSecrets: SecretResolver = {
  resolve: (secretRef: string) => Promise.resolve(`resolved:${secretRef}`),
};

const makeAgent = (toggles: Partial<AgentConfig['harness']['featureToggles']> = {}): AgentConfig =>
  AgentConfigSchema.parse({
    id: 'oc-agent',
    workspaceId: 'ws-1',
    name: 'OpenCode Agent',
    harness: { provider: 'opencode', featureToggles: toggles },
    credentialProfileId: 'cp-1',
  });

const apiKeyCredential = CredentialProfileSchema.parse({
  id: 'cp-1',
  kind: 'api-key',
  secretRef: 'anthropic/main',
});

let agentDir: string;

beforeEach(async () => {
  agentDir = await mkdtemp(path.join(os.tmpdir(), 'aeos-oc-profile-'));
});

afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true });
});

describe('buildOpencodeProfile — hermeticity', () => {
  it('points all four XDG homes inside <agent>/harness/opencode and disables project config', async () => {
    const profile = await buildOpencodeProfile({
      agent: makeAgent(),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    const root = path.join(agentDir, 'harness', 'opencode');
    expect(profile.rootDir).toBe(root);
    for (const [key, sub] of [
      ['XDG_CONFIG_HOME', 'config'],
      ['XDG_DATA_HOME', 'data'],
      ['XDG_STATE_HOME', 'state'],
      ['XDG_CACHE_HOME', 'cache'],
    ] as const) {
      expect(profile.env[key]).toBe(path.join(root, sub));
      expect((await stat(profile.env[key] as string)).isDirectory()).toBe(true);
    }
    expect(profile.env['OPENCODE_DISABLE_PROJECT_CONFIG']).toBe('1');
  });

  it('references no $HOME, ~/, or default XDG paths anywhere', async () => {
    const profile = await buildOpencodeProfile({
      agent: makeAgent({ mcpServers: true }),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    const everything = JSON.stringify(profile);
    expect(everything).not.toContain('$HOME');
    expect(everything).not.toContain('~/');
    expect(everything).not.toContain(path.join(os.homedir(), '.config'));
    expect(everything).not.toContain(path.join(os.homedir(), '.local'));
  });

  it('generated opencode.json round-trips the feature toggles', async () => {
    const toggles = { plugins: true, skills: false, mcpServers: true, userClaudeMd: false, autoMemory: true };
    const profile = await buildOpencodeProfile({
      agent: makeAgent(toggles),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    const raw = await readFile(
      path.join(profile.env['XDG_CONFIG_HOME'] as string, 'opencode', 'opencode.json'),
      'utf8',
    );
    expect(parseGeneratedConfig(raw).featureToggles).toEqual(toggles);
    expect(raw).not.toContain('resolved:');
  });
});

describe('buildOpencodeProfile — credentials', () => {
  it('api-key and gateway map to the documented env vars', async () => {
    const apiKey = await buildOpencodeProfile({
      agent: makeAgent(),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    expect(apiKey.env['ANTHROPIC_API_KEY']).toBe('resolved:anthropic/main');

    const gateway = await buildOpencodeProfile({
      agent: makeAgent(),
      agentDir,
      credential: CredentialProfileSchema.parse({
        id: 'cp-gw',
        kind: 'gateway',
        baseUrl: 'https://gw.example.com',
        secretRef: 'gateway/token',
      }),
      secrets: stubSecrets,
    });
    expect(gateway.env['ANTHROPIC_BASE_URL']).toBe('https://gw.example.com');
    expect(gateway.env['ANTHROPIC_AUTH_TOKEN']).toBe('resolved:gateway/token');
  });

  it('subscription slots isolate persistent data homes (auth.json lives there)', async () => {
    const subsRoot = path.join(agentDir, 'subs');
    const build = (id: string, slot: string) =>
      buildOpencodeProfile({
        agent: makeAgent(),
        agentDir,
        credential: CredentialProfileSchema.parse({ id, kind: 'subscription', slot }),
        secrets: stubSecrets,
        subscriptionHomeFor: (s) => path.join(subsRoot, s),
      });
    const acme = await build('cp-acme', 'client-acme');
    const globex = await build('cp-globex', 'client-globex');
    expect(acme.env['XDG_DATA_HOME']).toBe(path.join(subsRoot, 'client-acme'));
    expect(globex.env['XDG_DATA_HOME']).toBe(path.join(subsRoot, 'client-globex'));
    expect(acme.env['XDG_DATA_HOME']).not.toBe(globex.env['XDG_DATA_HOME']);
    // config stays per-agent even in subscription mode
    expect(acme.env['XDG_CONFIG_HOME']).toBe(path.join(agentDir, 'harness', 'opencode', 'config'));
    expect(acme.env['AEOS_SUBSCRIPTION_SLOT']).toBe('client-acme');
  });

  it('subscription without a slot-home mapper fails with a typed error', async () => {
    await expect(
      buildOpencodeProfile({
        agent: makeAgent(),
        agentDir,
        credential: CredentialProfileSchema.parse({ id: 'cp-sub', kind: 'subscription' }),
        secrets: stubSecrets,
      }),
    ).rejects.toThrow(MissingSubscriptionHomeError);
  });
});
