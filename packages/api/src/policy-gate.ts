import type {
  AeosEvent,
  AgentConfig,
  CompiledPolicy,
  EffectivePolicy,
} from '@aeos/contracts';
import type {
  CapabilityMatrix,
  HarnessAdapter,
  HarnessProfile,
  SessionHandle,
  SpawnOptions,
} from '@aeos/provider-core';
import { createSessionGuard, type ApprovalsRegistry } from '@aeos/policy';

export interface GuardAdapterOptions {
  /** Shared approvals inbox backing confirm-tier pauses (spec §11). */
  registry?: ApprovalsRegistry;
  /**
   * Resolves an agent's declared secret refs to runner-env entries. Only
   * consulted when the effective policy allows `secrets_access`; whatever
   * it returns is merged into the spawned profile's env.
   */
  inject?: (agent: AgentConfig) => Promise<Record<string, string>>;
}

/**
 * Wrap an adapter so every spawned session (a) passes through the
 * daemon-side policy guard and (b) receives declared secrets in its env
 * only when the effective policy allows `secrets_access` (spec §11
 * defense in depth — deny-by-default, allowlist of declared refs only).
 */
export function guardAdapter(
  adapter: HarnessAdapter,
  effective: EffectivePolicy,
  options?: GuardAdapterOptions,
): HarnessAdapter {
  const guard = createSessionGuard(
    options?.registry === undefined ? { effective } : { effective, registry: options.registry },
  );
  return {
    id: adapter.id,
    capabilities: () => adapter.capabilities(),
    createProfile: async (agent) => {
      const profile = await adapter.createProfile(agent);
      if (options?.inject === undefined || effective.tiers.secrets_access !== 'allow') {
        return profile;
      }
      const extra = await options.inject(agent);
      return { ...profile, env: { ...profile.env, ...extra } };
    },
    spawn: (opts) => {
      const handle = adapter.spawn(opts);
      return { ...handle, events: guard(handle.events) };
    },
    translate: (raw) => adapter.translate(raw),
  };
}
