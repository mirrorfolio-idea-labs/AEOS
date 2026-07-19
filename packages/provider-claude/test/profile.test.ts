import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigSchema, CredentialProfileSchema, type AgentConfig } from '@aeos/contracts';
import { buildClaudeProfile, parseGeneratedSettings, type SecretResolver } from '../src/profile.js';

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
    });
    expect(profile.env['AEOS_CREDENTIAL_PASSTHROUGH']).toBe('subscription');
    expect(profile.env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(profile.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    expect(JSON.stringify(profile)).not.toContain('resolved:');
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
