import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AgentConfig, CredentialProfile } from '@aeos/contracts';
import type { HarnessProfile } from '@aeos/provider-core';

/**
 * Resolves a `secretRef` (from a CredentialProfile) to its secret value.
 * The daemon secret store lands in P2.M3 — until then callers supply their
 * own resolver; tests use a stub. Secret VALUES only ever enter `env`,
 * never argv, settings.json, or any other file.
 */
export interface SecretResolver {
  resolve(secretRef: string): Promise<string>;
}

export interface BuildClaudeProfileOptions {
  agent: AgentConfig;
  /** Absolute path of the agent's directory; harness state goes under `harness/claude`. */
  agentDir: string;
  credential: CredentialProfile;
  secrets: SecretResolver;
  /**
   * Maps a subscription account slot to its persistent login home (e.g.
   * `<AEOS_HOME>/subscriptions/<slot>`). One `claude login` inside that dir
   * binds the slot to one Claude Pro/Max account; different slots run
   * concurrently on different accounts. Required for `subscription` profiles.
   */
  subscriptionHomeFor?: (slot: string) => string;
}

export class MissingSubscriptionHomeError extends Error {
  constructor(slot: string) {
    super(
      `credential kind "subscription" (slot "${slot}") requires subscriptionHomeFor to map the slot to its persistent login home`,
    );
    this.name = 'MissingSubscriptionHomeError';
  }
}

const GeneratedSettingsSchema = z.object({
  generatedBy: z.literal('@aeos/provider-claude'),
  agentId: z.string(),
  featureToggles: z.object({
    plugins: z.boolean(),
    skills: z.boolean(),
    mcpServers: z.boolean(),
    userClaudeMd: z.boolean(),
    autoMemory: z.boolean(),
  }),
});
export type GeneratedSettings = z.infer<typeof GeneratedSettingsSchema>;

export function parseGeneratedSettings(raw: string): GeneratedSettings {
  return GeneratedSettingsSchema.parse(JSON.parse(raw));
}

/** toggle key → the CLAUDE_CODE_DISABLE_* env var used when it is OFF. */
const DISABLE_ENV: Record<keyof GeneratedSettings['featureToggles'], string> = {
  plugins: 'CLAUDE_CODE_DISABLE_PLUGINS',
  skills: 'CLAUDE_CODE_DISABLE_SKILLS',
  mcpServers: 'CLAUDE_CODE_DISABLE_MCP',
  userClaudeMd: 'CLAUDE_CODE_DISABLE_USER_CLAUDE_MD',
  autoMemory: 'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
};

async function credentialEnv(
  credential: CredentialProfile,
  secrets: SecretResolver,
): Promise<Record<string, string>> {
  switch (credential.kind) {
    case 'api-key':
      return { ANTHROPIC_API_KEY: await secrets.resolve(credential.secretRef) };
    case 'gateway':
      return {
        ANTHROPIC_BASE_URL: credential.baseUrl,
        ANTHROPIC_AUTH_TOKEN: await secrets.resolve(credential.secretRef),
        ...(credential.model === undefined ? {} : { ANTHROPIC_MODEL: credential.model }),
      };
    case 'subscription':
      // Explicit opt-in login passthrough — the slot's login home carries
      // the account's OAuth state; no secret material is written or
      // injected here.
      return {
        AEOS_CREDENTIAL_PASSTHROUGH: 'subscription',
        AEOS_SUBSCRIPTION_SLOT: credential.slot,
      };
  }
}

/**
 * Build the hermetic per-agent Claude Code profile (spec §9, D2).
 * Everything lives under `<agentDir>/harness/claude`; the user's global
 * `~/.claude` is never referenced. Features are hermetic-by-default:
 * OFF → `CLAUDE_CODE_DISABLE_*` env; ON → explicit re-enable flags rooted
 * inside the profile dir.
 */
export async function buildClaudeProfile(
  opts: BuildClaudeProfileOptions,
): Promise<HarnessProfile> {
  const { agent, agentDir, credential, secrets } = opts;
  const rootDir = path.join(agentDir, 'harness', 'claude');
  const toggles = agent.harness.featureToggles;

  const settings: GeneratedSettings = {
    generatedBy: '@aeos/provider-claude',
    agentId: agent.id,
    featureToggles: toggles,
  };
  await mkdir(rootDir, { recursive: true });
  const settingsPath = path.join(rootDir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  // api-key/gateway sessions are fully throwaway: config dir = agent profile
  // dir. Subscription sessions must reuse the slot's persistent login home —
  // that's where `claude login` stored the account's OAuth state.
  let configDir = rootDir;
  if (credential.kind === 'subscription') {
    if (!opts.subscriptionHomeFor) throw new MissingSubscriptionHomeError(credential.slot);
    configDir = opts.subscriptionHomeFor(credential.slot);
    await mkdir(configDir, { recursive: true });
  }

  const env: Record<string, string> = {
    CLAUDE_CONFIG_DIR: configDir,
    // Non-secret marker so cost.usage events can be tagged with the profile
    // that paid for them (spec §9 BYOK) — read back by ClaudeAdapter.spawn.
    AEOS_CREDENTIAL_PROFILE_ID: credential.id,
    ...(await credentialEnv(credential, secrets)),
  };
  const argv: string[] = ['--bare', '--settings', settingsPath];

  for (const [key, disableVar] of Object.entries(DISABLE_ENV) as Array<
    [keyof GeneratedSettings['featureToggles'], string]
  >) {
    if (!toggles[key]) env[disableVar] = '1';
  }
  if (toggles.plugins) argv.push('--plugin-dir', path.join(rootDir, 'plugins'));
  if (toggles.mcpServers) argv.push('--mcp-config', path.join(rootDir, 'mcp.json'));

  return { rootDir, env, argv };
}
