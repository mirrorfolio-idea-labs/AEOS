import type { EffectivePolicy } from '@aeos/contracts';
import type { HarnessAdapter } from '@aeos/provider-core';
import { createSessionGuard, type ApprovalsRegistry } from '@aeos/policy';

/**
 * Wrap an adapter so every spawned session's event stream passes through the
 * daemon-side policy guard (spec §11 defense in depth). The harness sees its
 * native flags; the guard is authoritative regardless of what those flags do.
 */
export function guardAdapter(
  adapter: HarnessAdapter,
  effective: EffectivePolicy,
  registry?: ApprovalsRegistry,
): HarnessAdapter {
  const guard = createSessionGuard(
    registry === undefined ? { effective } : { effective, registry },
  );
  return {
    id: adapter.id,
    capabilities: () => adapter.capabilities(),
    createProfile: (agent) => adapter.createProfile(agent),
    spawn: (opts) => {
      const handle = adapter.spawn(opts);
      return { ...handle, events: guard(handle.events) };
    },
    translate: (raw) => adapter.translate(raw),
  };
}
