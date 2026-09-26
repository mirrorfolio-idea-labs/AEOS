import fs from 'node:fs';
import path from 'node:path';
import { agentDir, getAgent, type EventBus, type IndexDb } from '@aeos/kernel';
import type { Supervisor } from '@aeos/runner';
import {
  CredentialProfileSchema,
  PLUGIN_ABI_VERSION,
  type AgentConfig,
  type BuiltinProvider,
  type CredentialProfile,
  type ProviderId,
} from '@aeos/contracts';
import { PLANNING_MARKER } from '@aeos/scheduler';
import { loadPricingIndex } from '@aeos/router';
import {
  FakeAdapter,
  buildFixtureEvents,
  createBinaryManager,
  gateAdapter,
  resolveHarnessCommand,
  type HarnessAdapter,
  type ManagedHarness,
  type ResolvedHarness,
  containerArgv,
  currentUser,
  homeLabelFor,
  reapContainers,
  type CommandContext,
} from '@aeos/provider-core';
import { ClaudeAdapter, type SecretResolver } from '@aeos/provider-claude';
import { OpencodeAdapter } from '@aeos/provider-opencode';
import { CodexAdapter } from '@aeos/provider-codex';
import { createApprovalsRegistry, type SandboxChoice } from '@aeos/policy';
import { createPluginRegistry } from '@aeos/plugins';
import { loadPolicyStack } from '@aeos/policy';
import { secretEnvName, type SecretStore } from '@aeos/secrets';
import {
  createApiServer,
  listenApi,
  resumeIncompleteObjectives,
  runningObjectiveCount,
  startObjectiveRun,
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
  /** Start (or resume) an objective — the wakeup scheduler's action seam (P3.M5). */
  startObjective(workspaceId: string, agentId: string, objectiveId: string): void;
  /** True while any objective run is in flight (idle-job input). */
  busy(): boolean;
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

/**
 * The fake provider's "model" for planner calls (P3.M1): a deterministic,
 * classed plan derived from the objective line, so the autonomy loop runs
 * end-to-end without a network.
 */
export function fakePlanner(prompt: string): string | undefined {
  if (!prompt.startsWith(PLANNING_MARKER)) return undefined;
  const objective = /^Objective: (.+)$/m.exec(prompt)?.[1] ?? 'the objective';
  return [
    'Here is the plan:',
    `- [ ] **T1** [architect] Outline the approach for ${objective}`,
    `- [ ] **T2** [implement] Implement ${objective}`,
    `- [ ] **T3** [review] Review the change against the definition of done`,
  ].join('\n');
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
  // P2.M7 managed harness binaries: pins resolve to verified installs only
  const binaries = createBinaryManager({ root: path.join(home, 'binaries') });

  const homeLabel = homeLabelFor(home);
  // P4.M1: containers of sessions that died with a previous daemon are never
  // adopted in place (resume re-spawns from the checkpoint) — reap them
  const reaped = reapContainers(homeLabel, config.env['AEOS_DOCKER'] ?? 'docker');
  if (reaped.length > 0) console.error(`sandbox: reaped ${String(reaped.length)} orphaned container(s)`);
  type AdapterOpts = { provider?: ProviderId; sandbox?: SandboxChoice };
  const fakeAdapter = (agent: AgentConfig): HarnessAdapter => {
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
      respond: (prompt) => {
        // e2e seam (P3 exit gate): record every session brief so a test can
        // prove what the next session actually saw
        const promptLog = config.env['AEOS_FAKE_PROMPT_LOG'];
        if (promptLog !== undefined) fs.appendFileSync(promptLog, `${JSON.stringify(prompt)}\n`);
        return fakePlanner(prompt);
      },
      ...(config.fakePaceMs === undefined ? {} : { paceMs: config.fakePaceMs }),
    });
  };
  const builtinAdapter = (provider: BuiltinProvider, agent: AgentConfig, opts: AdapterOpts): HarnessAdapter => {
    // an overridden provider ignores the agent's own pin (it names another harness)
    const own = provider === agent.harness.provider;
    let resolved: ResolvedHarness | undefined;
    const resolve = (): ResolvedHarness =>
      (resolved ??= resolveHarnessCommand(
        {
          harness: provider,
          version: own ? agent.harness.version : undefined,
          binaryPath: own ? agent.harness.binaryPath : undefined,
        },
        { manager: binaries },
      ));
    const knownVersion = (): string | undefined => {
      try {
        return resolve().version;
      } catch {
        return undefined; // resolution errors surface from spawn via resolveCommand
      }
    };
    const common = {
      agentDir: (a: AgentConfig) => agentDir(home, a.workspaceId, a.id),
      credential: (a: AgentConfig) => credentialFor(config, a),
      secrets,
      subscriptionHomeFor,
      resolveCommand: (cmd: CommandContext): readonly string[] => {
        const command = resolve().command;
        const sandbox = opts.sandbox;
        if (sandbox === undefined || sandbox.tier !== 'container') return command;
        // P4.M1 container tier: the harness sees the worktree, its profile and
        // its own (read-only) binary — nothing else of this host
        const binary = command[0];
        const mounts =
          binary !== undefined && path.isAbsolute(binary)
            ? [{ host: binary.startsWith(path.join(home, 'binaries') + path.sep) ? path.join(home, 'binaries') : fs.realpathSync(binary), readOnly: true }]
            : [];
        const user = currentUser();
        return containerArgv(command, cmd, {
          image: sandbox.image,
          network: sandbox.network,
          homeLabel,
          mounts,
          ...(user === undefined ? {} : { user }),
          ...(config.env['AEOS_DOCKER'] === undefined ? {} : { docker: config.env['AEOS_DOCKER'] }),
        });
      },
    };
    const gated = (adapter: HarnessAdapter, harness: ManagedHarness): HarnessAdapter =>
      gateAdapter(adapter, harness, knownVersion);
    if (provider === 'opencode') return gated(new OpencodeAdapter(common), provider);
    if (provider === 'codex') {
      return gated(
        new CodexAdapter({
          ...common,
          // ChatGPT-plan slots map to persistent login homes (P2.M3 resolver
          // fallback covers non-env refs; subscription passthrough is opt-in)
          subscriptionHomeFor: (slot: string) => path.join(home, 'subscriptions', slot),
        }),
        provider,
      );
    }
    return gated(new ClaudeAdapter(common), provider);
  };

  // P4.M2 plugin registry: the first-party harnesses are core plugins going
  // through the same manifest + contract gate as third-party ones (spec §15)
  const registry = createPluginRegistry<AdapterOpts>({ home, log: (line) => console.error(line) });
  for (const [id, pkg] of [
    ['claude-code', '@aeos/provider-claude'],
    ['codex', '@aeos/provider-codex'],
    ['opencode', '@aeos/provider-opencode'],
  ] as const) {
    registry.registerCore(
      { name: pkg, version: '0.1.0', manifest: { contract: `^${PLUGIN_ABI_VERSION}`, entry: '.', contributes: [{ kind: 'provider', id }] } },
      { [id]: (agent, opts) => builtinAdapter(id, agent, opts) },
    );
  }
  for (const entry of await registry.loadInstalled()) {
    console.error(`plugins: ${entry.name}@${entry.version} ${entry.state}${entry.error === undefined ? '' : ` — ${entry.error}`}`);
  }

  const adapterFor = (agent: AgentConfig, opts?: AdapterOpts): HarnessAdapter => {
    // E2E override > router's per-class choice (P3.M2) > the agent's harness
    const provider = config.providerOverride ?? opts?.provider ?? agent.harness.provider;
    if (provider === 'fake') return fakeAdapter(agent);
    const factory = registry.provider(provider);
    if (factory === undefined) {
      throw new Error(`no provider "${provider}" is registered — is its plugin installed and loadable? (aeos plugin list)`);
    }
    if (provider.startsWith('plugin:') && opts?.sandbox?.tier === 'container') {
      // fail closed: a plugin provider's process is not spawned through the
      // container wrapper, so it cannot honour a container-tier policy
      throw new Error(`policy requires the container sandbox tier, which plugin provider "${provider}" does not support yet`);
    }
    return factory(agent, opts ?? {});
  };

  // daily OpenRouter refresh; AEOS_PRICING_OFFLINE=1 pins the cached/static table
  const pricing = () =>
    loadPricingIndex({ home, offline: config.env['AEOS_PRICING_OFFLINE'] === '1' || config.providerOverride === 'fake' });
  const app = await createApiServer({
    home,
    adapterFor,
    pricing,
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
    pricing,
    credentialFor: (agent) => credentialFor(config, agent),
    bus,
    db,
  };
  const resumed = await resumeIncompleteObjectives(ctx);

  return {
    address,
    resumed,
    close: async () => {
      registry.close();
      await app.close();
    },
    startObjective: (workspaceId, agentId, objectiveId) => startObjectiveRun(ctx, workspaceId, agentId, objectiveId),
    busy: () => runningObjectiveCount() > 0,
  };
}
