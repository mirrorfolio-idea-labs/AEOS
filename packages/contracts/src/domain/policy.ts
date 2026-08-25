import { z } from 'zod';

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
] as const;

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
  })
  .strict();

/**
 * One layer of a policy file. Every field is optional so layers stay
 * minimal; `.strict()` rejects stray keys (typo = loud error, not silence).
 */
export const PolicyFileSchema = z
  .object({
    tiers: TiersSchema.optional(),
    confirmTimeoutSeconds: z.number().int().positive().optional(),
  })
  .strict();
export type PolicyFile = z.infer<typeof PolicyFileSchema>;

/** Fully-resolved policy: every tier has a mode, timeout is concrete. */
export const EffectivePolicySchema = z
  .object({
    tiers: z.record(TierSchema, PolicyModeSchema),
    confirmTimeoutSeconds: z.number().int().positive(),
  })
  .strict();
export type EffectivePolicy = z.infer<typeof EffectivePolicySchema>;
