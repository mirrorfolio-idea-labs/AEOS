import fs from 'node:fs';
import path from 'node:path';
import { agentDir, type EventBus, type IndexDb } from '@aeos/kernel';
import { CredentialProfileSchema, type AgentConfig, type CredentialProfile } from '@aeos/contracts';
import { FakeAdapter, buildFixtureEvents, type HarnessAdapter } from '@aeos/provider-core';
import { ClaudeAdapter, type SecretResolver } from '@aeos/provider-claude';
import { OpencodeAdapter } from '@aeos/provider-opencode';
import {
  createApiServer,
  listenApi,
  resumeIncompleteObjectives,
  type ApiContext,
} from '@aeos/api';

export interface ApiModuleConfig {
  port: number;
  host?: string;
  token?: string;
  /** Force one provider for every agent (the E2E forces `fake`). */
  providerOverride?: 'fake' | 'claude-code' | 'opencode';
  /** Built ADE UI to serve at `/` (skipped when absent). */
  uiDir?: string;
  fakePaceMs?: number;
  /** Env snapshot (main.ts owns process.env) — used by the v0 secret resolver. */
  env: Readonly<Record<string, string | undefined>>;
}

export interface ApiModuleHandle {
  address: string;
  close(): Promise<void>;
  resumed: string[];
}

/**
 * Credential profiles v0 (secret store proper is P2.M3): an agent's
 * `credentialProfileId` of `sub:<slot>` selects a subscription slot
 * (login home under `<AEOS_HOME>/subscriptions/<slot>`); anything else is
 * an api-key profile resolved from `ANTHROPIC_API_KEY`.
 */
function credentialFor(config: ApiModuleConfig, agent: AgentConfig): CredentialProfile {
  if (agent.credentialProfileId.startsWith('sub:')) {
    return CredentialProfileSchema.parse({
      id: agent.credentialProfileId,
      kind: 'subscription',
      slot: agent.credentialProfileId.slice(4),
    });
  }
  return CredentialProfileSchema.parse({
    id: agent.credentialProfileId,
    kind: 'api-key',
    secretRef: 'env:ANTHROPIC_API_KEY',
  });
}

export async function startApiModule(
  home: string,
  db: IndexDb,
  bus: EventBus,
  config: ApiModuleConfig,
): Promise<ApiModuleHandle> {
  const secrets: SecretResolver = {
    resolve: (secretRef: string) => {
      const value = secretRef.startsWith('env:') ? config.env[secretRef.slice(4)] : undefined;
      if (value === undefined || value.length === 0) {
        return Promise.reject(new Error(`secret "${secretRef}" is not available in the daemon env`));
      }
      return Promise.resolve(value);
    },
  };
  const subscriptionHomeFor = (slot: string): string => path.join(home, 'subscriptions', slot);

  const adapterFor = (agent: AgentConfig): HarnessAdapter => {
    const provider = config.providerOverride ?? agent.harness.provider;
    if (provider === 'fake') {
      return new FakeAdapter({
        providerSessionId: `ses_${agent.id}`,
        events: buildFixtureEvents({ profileId: agent.credentialProfileId }),
        ...(config.fakePaceMs === undefined ? {} : { paceMs: config.fakePaceMs }),
      });
    }
    const common = {
      agentDir: (a: AgentConfig) => agentDir(home, a.workspaceId, a.id),
      credential: (a: AgentConfig) => credentialFor(config, a),
      secrets,
      subscriptionHomeFor,
    };
    return provider === 'opencode' ? new OpencodeAdapter(common) : new ClaudeAdapter(common);
  };

  const app = await createApiServer({
    home,
    adapterFor,
    credentialFor: (agent) => credentialFor(config, agent),
    bus,
    ...(config.token === undefined ? {} : { token: config.token }),
  });

  if (config.uiDir !== undefined && fs.existsSync(path.join(config.uiDir, 'index.html'))) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, { root: config.uiDir });
  }

  const address = await listenApi(app, {
    port: config.port,
    ...(config.host === undefined ? {} : { host: config.host }),
    ...(config.token === undefined ? {} : { token: config.token }),
  });

  const ctx: ApiContext = {
    home,
    adapterFor,
    credentialFor: (agent) => credentialFor(config, agent),
    bus,
    db,
  };
  const resumed = await resumeIncompleteObjectives(ctx);

  return {
    address,
    resumed,
    close: () => app.close(),
  };
}
