import { z } from 'zod';
import { EffectivePolicySchema } from './policy.js';

/**
 * Wire shape carried to runners through the framed protocol (spec §10) and
 * into adapter `SpawnOptions` (spec §9): the resolved policy plus whatever
 * harness-native flags each compiler produced. Plain data on purpose — any
 * language implementing a runner can consume it.
 */

export const NativeFlagsSchema = z
  .object({
    argv: z.array(z.string()),
    env: z.record(z.string(), z.string()),
  })
  .strict();
export type NativeFlags = z.infer<typeof NativeFlagsSchema>;

export const HARNESS_IDS = ['claude-code', 'codex', 'opencode'] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const CompiledPolicySchema = z
  .object({
    effective: EffectivePolicySchema,
    native: z
      .object({
        'claude-code': NativeFlagsSchema.optional(),
        'codex': NativeFlagsSchema.optional(),
        'opencode': NativeFlagsSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type CompiledPolicy = z.infer<typeof CompiledPolicySchema>;
