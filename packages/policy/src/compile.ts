import {
  CompiledPolicySchema,
  PERMISSION_TIERS,
  type CompiledPolicy,
  type EffectivePolicy,
  type PolicyMode,
} from '@aeos/contracts';

/**
 * Compile an effective policy into harness-native flags (spec §11). The
 * harness side is BEST-EFFORT containment (flags drift across versions);
 * the daemon-side guard (guard.ts) is authoritative. Golden tests pin the
 * exact argv/env output per tier×harness transition.
 */

/** Claude Code tool names per enforceable tier (spec §9 research notes). */
const CLAUDE_TOOLS: Partial<Record<string, readonly string[]>> = {
  write_files: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  execute_commands: ['Bash'],
  network_access: ['WebFetch', 'WebSearch'],
};

const CODEX_SANDBOXES = ['read-only', 'workspace-write'] as const;

function claudeCodeFlags(effective: EffectivePolicy): { argv: string[]; env: Record<string, string> } {
  const disallowed = new Set<string>();
  for (const [tier, tools] of Object.entries(CLAUDE_TOOLS)) {
    if (effective.tiers[tier as keyof typeof effective.tiers] !== 'allow') {
      for (const tool of tools ?? []) disallowed.add(tool);
    }
  }
  return {
    argv: disallowed.size === 0 ? [] : ['--disallowedTools', [...disallowed].sort().join(',')],
    env: {},
  };
}

function codexFlags(effective: EffectivePolicy): { argv: string[]; env: Record<string, string> } {
  const anyConfirm = PERMISSION_TIERS.some((t) => effective.tiers[t] === 'confirm');
  const sandbox: (typeof CODEX_SANDBOXES)[number] =
    effective.tiers.write_files === 'allow' ? 'workspace-write' : 'read-only';
  return {
    argv: ['--sandbox', sandbox, '--approval_policy', anyConfirm ? 'on-request' : 'never'],
    env: {},
  };
}

function opencodeFlags(effective: EffectivePolicy): { argv: string[]; env: Record<string, string> } {
  // OpenCode has no per-tier CLI surface; its hermetic profile receives the
  // effective tiers as data and the daemon gate does the enforcing.
  return { argv: [], env: { AEOS_POLICY_JSON: JSON.stringify(effective.tiers) } };
}

export function compilePolicy(effective: EffectivePolicy): CompiledPolicy {
  return CompiledPolicySchema.parse({
    effective,
    native: {
      'claude-code': claudeCodeFlags(effective),
      'codex': codexFlags(effective),
      'opencode': opencodeFlags(effective),
    },
  });
}

/** Convenience for golden tests: flip one tier without rebuilding the world. */
export function withTier(
  effective: EffectivePolicy,
  tier: string,
  mode: PolicyMode,
): EffectivePolicy {
  return {
    tiers: { ...effective.tiers, [tier]: mode },
    confirmTimeoutSeconds: effective.confirmTimeoutSeconds,
  } as EffectivePolicy;
}
