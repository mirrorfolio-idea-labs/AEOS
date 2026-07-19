import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigSchema, CredentialProfileSchema, type AgentConfig } from '@aeos/contracts';
import {
  buildClaudeProfile,
  MissingSubscriptionHomeError,
  parseGeneratedSettings,
  type SecretResolver,
} from '../src/profile.js';

const stubSecrets: SecretResolver = {
  resolve: (secretRef: string) => Promise.resolve(`resolved:${secretRef}`),
};

const makeAgent = (toggles: Partial<AgentConfig['harness']['featureToggles']> = {}): AgentConfig =>
  AgentConfigSchema.parse({
    id: 'claude-agent',
    workspaceId: 'ws-1',
    name: 'Claude Agent',
    harness: { provider: 'claude-code', featureToggles: toggles },
    credentialProfileId: 'cp-1',
  });

const apiKeyCredential = CredentialProfileSchema.parse({
  id: 'cp-1',
  kind: 'api-key',
  secretRef: 'anthropic/main',
});

let agentDir: string;

beforeEach(async () => {
  agentDir = await mkdtemp(path.join(os.tmpdir(), 'aeos-claude-profile-'));
});

afterEach(async () => {
  await rm(agentDir, { recursive: true, force: true });
});

describe('buildClaudeProfile — hermeticity', () => {
  it('roots all harness state under <agent>/harness/claude', async () => {
    const profile = await buildClaudeProfile({
      agent: makeAgent(),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    expect(profile.rootDir).toBe(path.join(agentDir, 'harness', 'claude'));
    expect(profile.env['CLAUDE_CONFIG_DIR']).toBe(profile.rootDir);
  });

  it('contains zero references to ~/.claude or $HOME anywhere', async () => {
    const profile = await buildClaudeProfile({
      agent: makeAgent({ plugins: true, mcpServers: true }),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    const everything = JSON.stringify(profile) + (await readFile(path.join(profile.rootDir, 'settings.json'), 'utf8'));
    expect(everything).not.toContain('~/.claude');
    expect(everything).not.toContain(os.homedir() + '/.claude');
    expect(everything).not.toContain('$HOME');
  });

  it('always passes --bare and --settings pointing into the profile dir', async () => {
    const profile = await buildClaudeProfile({
      agent: makeAgent(),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    expect(profile.argv).toContain('--bare');
    const settingsIdx = profile.argv.indexOf('--settings');
    expect(settingsIdx).toBeGreaterThanOrEqual(0);
    expect(profile.argv[settingsIdx + 1]).toBe(path.join(profile.rootDir, 'settings.json'));
  });
});

describe('buildClaudeProfile — feature toggles', () => {
  it('all-off default: every feature disabled via CLAUDE_CODE_DISABLE_* env', async () => {
    const profile = await buildClaudeProfile({
      agent: makeAgent(),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    expect(profile.env['CLAUDE_CODE_DISABLE_PLUGINS']).toBe('1');
    expect(profile.env['CLAUDE_CODE_DISABLE_SKILLS']).toBe('1');
    expect(profile.env['CLAUDE_CODE_DISABLE_MCP']).toBe('1');
    expect(profile.env['CLAUDE_CODE_DISABLE_USER_CLAUDE_MD']).toBe('1');
    expect(profile.env['CLAUDE_CODE_DISABLE_AUTO_MEMORY']).toBe('1');
    expect(profile.argv).not.toContain('--plugin-dir');
    expect(profile.argv).not.toContain('--mcp-config');
  });

  it('enabled toggles re-enable via explicit flags rooted in the profile dir', async () => {
    const profile = await buildClaudeProfile({
      agent: makeAgent({ plugins: true, mcpServers: true }),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    expect(profile.env['CLAUDE_CODE_DISABLE_PLUGINS']).toBeUndefined();
    expect(profile.env['CLAUDE_CODE_DISABLE_MCP']).toBeUndefined();
    const pluginIdx = profile.argv.indexOf('--plugin-dir');
    expect(profile.argv[pluginIdx + 1]).toBe(path.join(profile.rootDir, 'plugins'));
    const mcpIdx = profile.argv.indexOf('--mcp-config');
    expect(profile.argv[mcpIdx + 1]).toBe(path.join(profile.rootDir, 'mcp.json'));
  });

  it('toggles round-trip through the generated settings.json', async () => {
    const toggles = { plugins: true, skills: false, mcpServers: true, userClaudeMd: false, autoMemory: true };
    const profile = await buildClaudeProfile({
      agent: makeAgent(toggles),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    const parsed = parseGeneratedSettings(await readFile(path.join(profile.rootDir, 'settings.json'), 'utf8'));
    expect(parsed.featureToggles).toEqual(toggles);
  });
});

describe('buildClaudeProfile — credential injection', () => {
  it('api-key → ANTHROPIC_API_KEY from the resolver, nothing else', async () => {
    const profile = await buildClaudeProfile({
      agent: makeAgent(),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    expect(profile.env['ANTHROPIC_API_KEY']).toBe('resolved:anthropic/main');
    expect(profile.env['ANTHROPIC_BASE_URL']).toBeUndefined();
    expect(profile.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
  });

  it('gateway → BASE_URL + AUTH_TOKEN (+ optional MODEL)', async () => {
    const credential = CredentialProfileSchema.parse({
      id: 'cp-gw',
      kind: 'gateway',
      baseUrl: 'https://gw.example.com',
      secretRef: 'gateway/token',
      model: 'claude-fable-5',
    });
    const profile = await buildClaudeProfile({
      agent: makeAgent(),
      agentDir,
      credential,
      secrets: stubSecrets,
    });
    expect(profile.env['ANTHROPIC_BASE_URL']).toBe('https://gw.example.com');
    expect(profile.env['ANTHROPIC_AUTH_TOKEN']).toBe('resolved:gateway/token');
    expect(profile.env['ANTHROPIC_MODEL']).toBe('claude-fable-5');
    expect(profile.env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('subscription → passthrough marker only, no secret material anywhere', async () => {
    const credential = CredentialProfileSchema.parse({ id: 'cp-sub', kind: 'subscription' });
    const profile = await buildClaudeProfile({
      agent: makeAgent(),
      agentDir,
      credential,
      secrets: stubSecrets,
      subscriptionHomeFor: (slot) => path.join(agentDir, 'subs', slot),
    });
    expect(profile.env['AEOS_CREDENTIAL_PASSTHROUGH']).toBe('subscription');
    expect(profile.env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(profile.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    expect(JSON.stringify(profile)).not.toContain('resolved:');
  });

  it('multi-account slots: different subscriptions get isolated persistent login homes', async () => {
    const subsRoot = path.join(agentDir, 'aeos-home', 'subscriptions');
    const homeFor = (slot: string) => path.join(subsRoot, slot);
    const build = (id: string, slot: string) =>
      buildClaudeProfile({
        agent: makeAgent(),
        agentDir,
        credential: CredentialProfileSchema.parse({ id, kind: 'subscription', slot }),
        secrets: stubSecrets,
        subscriptionHomeFor: homeFor,
      });
    const acme = await build('cp-acme', 'client-acme');
    const globex = await build('cp-globex', 'client-globex');
    expect(acme.env['CLAUDE_CONFIG_DIR']).toBe(path.join(subsRoot, 'client-acme'));
    expect(globex.env['CLAUDE_CONFIG_DIR']).toBe(path.join(subsRoot, 'client-globex'));
    expect(acme.env['CLAUDE_CONFIG_DIR']).not.toBe(globex.env['CLAUDE_CONFIG_DIR']);
    expect(acme.env['AEOS_SUBSCRIPTION_SLOT']).toBe('client-acme');
    // login homes exist on disk, ready for a one-time `claude login` each
    expect((await stat(acme.env['CLAUDE_CONFIG_DIR'] as string)).isDirectory()).toBe(true);
    expect((await stat(globex.env['CLAUDE_CONFIG_DIR'] as string)).isDirectory()).toBe(true);
    // per-agent settings/profile state still lives in the agent dir, not the shared login home
    expect(acme.rootDir).toBe(path.join(agentDir, 'harness', 'claude'));
  });

  it('old slot-less subscription profiles default to the "default" slot', async () => {
    const credential = CredentialProfileSchema.parse({ id: 'cp-old', kind: 'subscription' });
    const profile = await buildClaudeProfile({
      agent: makeAgent(),
      agentDir,
      credential,
      secrets: stubSecrets,
      subscriptionHomeFor: (slot) => path.join(agentDir, 'subs', slot),
    });
    expect(profile.env['CLAUDE_CONFIG_DIR']).toBe(path.join(agentDir, 'subs', 'default'));
  });

  it('subscription without a slot-home mapper fails with a typed error', async () => {
    await expect(
      buildClaudeProfile({
        agent: makeAgent(),
        agentDir,
        credential: CredentialProfileSchema.parse({ id: 'cp-sub', kind: 'subscription' }),
        secrets: stubSecrets,
      }),
    ).rejects.toThrow(MissingSubscriptionHomeError);
  });

  it('api-key sessions keep the throwaway agent-profile config dir', async () => {
    const profile = await buildClaudeProfile({
      agent: makeAgent(),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
      subscriptionHomeFor: (slot) => path.join(agentDir, 'subs', slot),
    });
    expect(profile.env['CLAUDE_CONFIG_DIR']).toBe(profile.rootDir);
  });

  it('secret values never land in the on-disk settings.json', async () => {
    const profile = await buildClaudeProfile({
      agent: makeAgent(),
      agentDir,
      credential: apiKeyCredential,
      secrets: stubSecrets,
    });
    const settings = await readFile(path.join(profile.rootDir, 'settings.json'), 'utf8');
    expect(settings).not.toContain('resolved:');
    expect(settings).not.toContain('sk-');
  });
});
