import {
  EffectivePolicySchema,
  PERMISSION_TIERS,
  type EffectivePolicy,
  type PermissionTier,
  type PolicyFile,
  type PolicyMode,
  type SandboxPolicy,
  type SandboxTier,
  type TaskClass,
} from '@aeos/contracts';

/**
 * Default posture for a brand-new agent (spec §11): read-only +
 * worktree-write + confirm-everything-else, deny-by-default on approval
 * expiry. Pinned here because the exit gate tests assert it byte-for-byte.
 */
export const DEFAULT_POSTURE: EffectivePolicy = EffectivePolicySchema.parse({
  tiers: Object.fromEntries(
    PERMISSION_TIERS.map((tier) => [
      tier,
      tier === 'read_files' || tier === 'write_files' ? 'allow' : 'confirm',
    ]),
  ) as Record<PermissionTier, PolicyMode>,
  confirmTimeoutSeconds: 300,
});

/**
 * Merge policy layers workspace → agent → objective (most-specific wins).
 * Each layer overrides only the keys it declares; everything else inherits
 * from earlier layers, falling back to DEFAULT_POSTURE.
 */
export function mergePolicyLayers(layers: Array<PolicyFile | undefined>): EffectivePolicy {
  const mergedTiers = { ...DEFAULT_POSTURE.tiers };
  let timeout = DEFAULT_POSTURE.confirmTimeoutSeconds;
  let sandbox: SandboxPolicy | undefined;
  for (const layer of layers) {
    if (layer === undefined) continue;
    if (layer.tiers !== undefined) {
      for (const tier of PERMISSION_TIERS) {
        const mode = layer.tiers[tier];
        if (mode !== undefined) mergedTiers[tier] = mode;
      }
    }
    if (layer.confirmTimeoutSeconds !== undefined) timeout = layer.confirmTimeoutSeconds;
    if (layer.sandbox !== undefined) {
      // key-by-key like tiers; per-class overrides merge per class
      const classes = { ...sandbox?.classes, ...layer.sandbox.classes };
      sandbox = {
        ...sandbox,
        ...layer.sandbox,
        ...(Object.keys(classes).length === 0 ? {} : { classes }),
      };
    }
  }
  return EffectivePolicySchema.parse({
    tiers: mergedTiers,
    confirmTimeoutSeconds: timeout,
    ...(sandbox === undefined ? {} : { sandbox }),
  });
}

export const DEFAULT_SANDBOX_IMAGE = 'aeos-runner:local';

export interface SandboxChoice {
  tier: SandboxTier;
  image: string;
  network: 'none' | 'bridge';
}

/**
 * Which sandbox tier a task of `taskClass` runs in (spec §10, P4.M1): the
 * per-class override, else the policy's default tier, else `none`.
 */
export function sandboxFor(effective: EffectivePolicy, taskClass: TaskClass): SandboxChoice {
  const sandbox = effective.sandbox;
  return {
    tier: sandbox?.classes?.[taskClass] ?? sandbox?.tier ?? 'none',
    image: sandbox?.image ?? DEFAULT_SANDBOX_IMAGE,
    network: sandbox?.network ?? 'bridge',
  };
}
