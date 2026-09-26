import { z } from 'zod';
import { TaskClassSchema } from './objective.js';

/**
 * Permission tiers and policy-file shapes (spec §11). Policies are YAML
 * files layered workspace → agent → objective (most-specific wins); this
 * module defines only the vocabulary — merging/loading lives in @aeos/policy.
 */

export const PERMISSION_TIERS = [
  'read_files',
  'write_files',
  'execute_commands',
  'install_packages',
  'git_commit',
  'git_push',
  'deploy',
  'secrets_access',
  'network_access',
  /**
   * Executing a planner-generated plan (P3.M1, spec §12). Not a tool tier:
   * `confirm` (default) parks the proposed plan for a human, `allow`
   * auto-runs it, `deny` keeps generated plans proposal-only.
   */
  'run_plan',
] as const;

/** Tiers that classify harness tool calls (everything except `run_plan`). */
export const TOOL_TIERS = PERMISSION_TIERS.filter((t) => t !== 'run_plan');

export type PermissionTier = (typeof PERMISSION_TIERS)[number];

export const TierSchema = z.enum(PERMISSION_TIERS);
export const PolicyModeSchema = z.enum(['allow', 'confirm', 'deny']);
export type PolicyMode = z.infer<typeof PolicyModeSchema>;

/** Tier→mode map; every tier key optional, unknown keys rejected via .strict(). */
export const TiersSchema = z
  .object({
    read_files: PolicyModeSchema.optional(),
    write_files: PolicyModeSchema.optional(),
    execute_commands: PolicyModeSchema.optional(),
    install_packages: PolicyModeSchema.optional(),
    git_commit: PolicyModeSchema.optional(),
    git_push: PolicyModeSchema.optional(),
    deploy: PolicyModeSchema.optional(),
    secrets_access: PolicyModeSchema.optional(),
    network_access: PolicyModeSchema.optional(),
    run_plan: PolicyModeSchema.optional(),
  })
  .strict();

/**
 * Sandbox tiers (spec §10, P4.M1): `none` — trusted local mode, still
 * worktree-scoped; `container` — the harness runs in a per-session Docker
 * container that sees only the worktree, its own profile dir and its
 * binary. Harness-native sandboxes compose inside whichever tier is active.
 */
export const SANDBOX_TIERS = ['none', 'container'] as const;
export const SandboxTierSchema = z.enum(SANDBOX_TIERS);
export type SandboxTier = z.infer<typeof SandboxTierSchema>;

/** Sandbox layer: a default tier, per-task-class overrides, container knobs. */
export const SandboxPolicySchema = z
  .object({
    tier: SandboxTierSchema.optional(),
    classes: z.record(TaskClassSchema, SandboxTierSchema).optional(),
    /** Container image (default `aeos-runner:local`, built by `aeos sandbox build`). */
    image: z.string().min(1).optional(),
    /** `bridge` (default — the harness must reach its model API) or `none`. */
    network: z.enum(['none', 'bridge']).optional(),
  })
  .strict();
export type SandboxPolicy = z.infer<typeof SandboxPolicySchema>;

/**
 * One layer of a policy file. Every field is optional so layers stay
 * minimal; `.strict()` rejects stray keys (typo = loud error, not silence).
 */
export const PolicyFileSchema = z
  .object({
    tiers: TiersSchema.optional(),
    confirmTimeoutSeconds: z.number().int().positive().optional(),
    sandbox: SandboxPolicySchema.optional(),
  })
  .strict();
export type PolicyFile = z.infer<typeof PolicyFileSchema>;

/** Fully-resolved policy: every tier has a mode, timeout is concrete. */
export const EffectivePolicySchema = z
  .object({
    tiers: z.record(TierSchema, PolicyModeSchema),
    confirmTimeoutSeconds: z.number().int().positive(),
    /** Present only when some layer declares one — absent means tier `none`. */
    sandbox: SandboxPolicySchema.optional(),
  })
  .strict();
export type EffectivePolicy = z.infer<typeof EffectivePolicySchema>;
