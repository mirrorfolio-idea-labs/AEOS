import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AgentConfig, CredentialProfile } from '@aeos/contracts';
import type { HarnessProfile } from '@aeos/provider-core';

/** Same contract as provider-claude's resolver — the store itself is P2.M3. */
export interface SecretResolver {
  resolve(secretRef: string): Promise<string>;
}

export interface BuildOpencodeProfileOptions {
  agent: AgentConfig;
  /** Absolute path of the agent's directory; harness state goes under `harness/opencode`. */
  agentDir: string;
  credential: CredentialProfile;
  secrets: SecretResolver;
  /**
   * Subscription slot → persistent data home. OpenCode keeps `auth.json`
   * under its data dir, so the slot maps to `XDG_DATA_HOME` (one
   * `opencode auth login` inside binds one account); config/state/cache
   * stay per-agent. Required for `subscription` profiles.
   */
  subscriptionHomeFor?: (slot: string) => string;
}

export class MissingSubscriptionHomeError extends Error {
  constructor(slot: string) {
    super(
      `credential kind "subscription" (slot "${slot}") requires subscriptionHomeFor to map the slot to its persistent data home`,
    );
    this.name = 'MissingSubscriptionHomeError';
  }
}

const GeneratedConfigSchema = z.object({
  generatedBy: z.literal('@aeos/provider-opencode'),
  agentId: z.string(),
  featureToggles: z.object({
    plugins: z.boolean(),
    skills: z.boolean(),
    mcpServers: z.boolean(),
    userClaudeMd: z.boolean(),
    autoMemory: z.boolean(),
  }),
});
export type GeneratedConfig = z.infer<typeof GeneratedConfigSchema>;

export function parseGeneratedConfig(raw: string): GeneratedConfig {
  return GeneratedConfigSchema.parse(JSON.parse(raw));
}

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
      return {
        AEOS_CREDENTIAL_PASSTHROUGH: 'subscription',
        AEOS_SUBSCRIPTION_SLOT: credential.slot,
      };
  }
}

/**
 * Hermetic per-agent OpenCode profile (spec §9): all four XDG homes point
 * inside `<agent>/harness/opencode/`, project-level config is disabled,
 * and the generated `opencode.json` mirrors the agent's feature toggles.
 * The user's real `~/.config/opencode` is never referenced.
 */
export async function buildOpencodeProfile(
  opts: BuildOpencodeProfileOptions,
): Promise<HarnessProfile> {
  const { agent, agentDir, credential, secrets } = opts;
  const rootDir = path.join(agentDir, 'harness', 'opencode');
  const homes = {
    XDG_CONFIG_HOME: path.join(rootDir, 'config'),
    XDG_DATA_HOME: path.join(rootDir, 'data'),
    XDG_STATE_HOME: path.join(rootDir, 'state'),
    XDG_CACHE_HOME: path.join(rootDir, 'cache'),
  };

  if (credential.kind === 'subscription') {
    if (!opts.subscriptionHomeFor) throw new MissingSubscriptionHomeError(credential.slot);
    homes.XDG_DATA_HOME = opts.subscriptionHomeFor(credential.slot);
  }
  await Promise.all(Object.values(homes).map((dir) => mkdir(dir, { recursive: true })));

  const configDir = path.join(homes.XDG_CONFIG_HOME, 'opencode');
  await mkdir(configDir, { recursive: true });
  const config: GeneratedConfig = {
    generatedBy: '@aeos/provider-opencode',
    agentId: agent.id,
    featureToggles: agent.harness.featureToggles,
  };
  await writeFile(
    path.join(configDir, 'opencode.json'),
    JSON.stringify(config, null, 2) + '\n',
    'utf8',
  );

  const env: Record<string, string> = {
    ...homes,
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    AEOS_CREDENTIAL_PROFILE_ID: credential.id,
    ...(await credentialEnv(credential, secrets)),
  };

  return { rootDir, env, argv: [] };
}
