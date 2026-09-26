import fs from 'node:fs';
import path from 'node:path';
import { agentDir, getAgent, type EventBus, type IndexDb } from '@aeos/kernel';
import type { Supervisor } from '@aeos/runner';
import { CredentialProfileSchema, type AgentConfig, type CredentialProfile } from '@aeos/contracts';
import { FakeAdapter, buildFixtureEvents, type HarnessAdapter } from '@aeos/provider-core';
import { ClaudeAdapter, type SecretResolver } from '@aeos/provider-claude';
import { OpencodeAdapter } from '@aeos/provider-opencode';
import { CodexAdapter } from '@aeos/provider-codex';
import { createApprovalsRegistry } from '@aeos/policy';
import { loadPolicyStack } from '@aeos/policy';
import { secretEnvName, type SecretStore } from '@aeos/secrets';
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
  providerOverride?: 'fake' | 'claude-code' | 'opencode' | 'codex';
  /** Built ADE UI to serve at `/` (skipped when absent). */
  uiDir?: string;
  fakePaceMs?: number;
  /** Confirm-tier approval deadline; expiry denies (spec §11). */
  approvalTimeoutMs?: number;
  /** Env snapshot (main.ts owns process.env) — used by the v0 secret resolver. */
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Store-backed secret refs (P2.M3): `env:` refs keep resolving from
   * `env`; anything else is looked up in the store when one is attached.
   */
  secretStore?: SecretStore;
  /**
   * Set by the daemon when redaction is active: every successfully
   * resolved value registers for pipeline-wide scrubbing (spec §11).
   */
  registerSecretValue?: (value: string) => void;
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
  supervisor?: Supervisor,
): Promise<ApiModuleHandle> {
  const secrets: SecretResolver = {
    resolve: (secretRef: string) => {
      const envValue = secretRef.startsWith('env:')
        ? config.env[secretRef.slice(4)]
        : undefined;
      const resolveEnv = (value: string): Promise<string> => {
        config.registerSecretValue?.(value);
        return Promise.resolve(value);
      };
      if (envValue !== undefined && envValue.length > 0) return resolveEnv(envValue);
      if (!secretRef.startsWith('env:') && config.secretStore !== undefined) {
        return config.secretStore.get(secretRef).then((v) => {
          config.registerSecretValue?.(v);
          return v;
        });
      }
      return Promise.reject(new Error(`secret "${secretRef}" is not available in the daemon env`));
    },
  };
  const subscriptionHomeFor = (slot: string): string => path.join(home, 'subscriptions', slot);

  const adapterFor = (agent: AgentConfig): HarnessAdapter => {
    const provider = config.providerOverride ?? agent.harness.provider;
    if (provider === 'fake') {
      const events = buildFixtureEvents({ profileId: agent.credentialProfileId });
      // e2e seam: a scripted tool output lets tests plant markers (e.g. the
      // P2.M3 canary-leak proof) without touching provider-core fixtures
      const scriptedOutput = config.env['AEOS_FAKE_TOOL_OUTPUT'];
      if (scriptedOutput !== undefined) {
        const result = events.find((e) => e.type === 'item.tool_result');
        if (result !== undefined && result.type === 'item.tool_result' && 'output' in result.payload) {
          result.payload.output = scriptedOutput;
        }
      }
      return new FakeAdapter({
        providerSessionId: `ses_${agent.id}`,
        events,
        ...(config.fakePaceMs === undefined ? {} : { paceMs: config.fakePaceMs }),
      });
    }
    const common = {
      agentDir: (a: AgentConfig) => agentDir(home, a.workspaceId, a.id),
      credential: (a: AgentConfig) => credentialFor(config, a),
      secrets,
      subscriptionHomeFor,
    };
    if (provider === 'opencode') return new OpencodeAdapter(common);
    if (provider === 'codex') {
      return new CodexAdapter({
        ...common,
        // ChatGPT-plan slots map to persistent login homes (P2.M3 resolver
        // fallback covers non-env refs; subscription passthrough is opt-in)
        subscriptionHomeFor: (slot: string) => path.join(home, 'subscriptions', slot),
      });
    }
    return new ClaudeAdapter(common);
  };

  const app = await createApiServer({
    home,
    adapterFor,
    credentialFor: (agent) => credentialFor(config, agent),
    bus,
    // spec §11: layered policy files + shared approvals inbox, daemon-enforced
    approvals: createApprovalsRegistry({ defaultTimeoutMs: config.approvalTimeoutMs ?? 300_000 }),
    policyFor: (agent) =>
      loadPolicyStack({
        home,
        workspaceId: agent.workspaceId,
        agentId: agent.id,
      }),
    // spec §11 injection: declared refs only, resolved env-first/store-second
    injectSecrets: async (agent) => {
      const entries: Record<string, string> = {};
      for (const ref of agent.secrets ?? []) {
        entries[secretEnvName(ref)] = await secrets.resolve(ref);
      }
      return entries;
    },
    // P2.M5 human takeover: supervisor-backed PTY bridge behind the policy gate
    ...(supervisor === undefined
      ? {}
      : {
          resolveAgent: (sessionId: string) => {
            const owner = supervisor.sessionOwner(sessionId);
            return owner === undefined
              ? undefined
              : getAgent(home, owner.workspaceId, owner.agentId);
          },
          attachPty: (sessionId: string, onOutput: (data: string) => void) =>
            supervisor.attachPty(sessionId, onOutput),
        }),
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
