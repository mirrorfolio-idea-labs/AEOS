import { describe, expect, it } from 'vitest';
import {
  CompiledPolicySchema,
  PERMISSION_TIERS,
  type EffectivePolicy,
  type PermissionTier,
  type PolicyMode,
} from '@aeos/contracts';
import { DEFAULT_POSTURE, compilePolicy } from '../src/index.js';

/** Default posture with selected tiers overridden — the golden-matrix driver. */
function policyWith(tiers: Partial<Record<PermissionTier, PolicyMode>>): EffectivePolicy {
  return {
    tiers: { ...DEFAULT_POSTURE.tiers, ...tiers },
    confirmTimeoutSeconds: DEFAULT_POSTURE.confirmTimeoutSeconds,
  };
}

describe('compilePolicy — default posture goldens', () => {
  const compiled = compilePolicy(DEFAULT_POSTURE);

  it('claude-code: reads/writes allowed; confirm-side tools disallowed natively', () => {
    expect(compiled.native['claude-code']).toEqual({
      argv: ['--disallowedTools', 'Bash,WebFetch,WebSearch'],
      env: {},
    });
  });

  it('codex: workspace-write sandbox + on-request approvals under the default posture', () => {
    expect(compiled.native['codex']).toEqual({
      argv: ['--sandbox', 'workspace-write', '--approval_policy', 'on-request'],
      env: {},
    });
  });

  it('opencode: no argv; effective tiers travel as env data', () => {
    expect(compiled.native['opencode']).toEqual({
      argv: [],
      env: { AEOS_POLICY_JSON: JSON.stringify(DEFAULT_POSTURE.tiers) },
    });
  });

  it('output validates against the CompiledPolicy wire schema', () => {
    expect(CompiledPolicySchema.safeParse(compiled).success).toBe(true);
  });
});

describe('tier × harness transition matrix (exact diffs)', () => {
  it('write_files deny adds the Edit family for claude and flips the codex sandbox', () => {
    const denied = compilePolicy(policyWith({ write_files: 'deny' }));
    expect(denied.native['claude-code']?.argv).toEqual([
      '--disallowedTools',
      'Bash,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch,Write',
    ]);
    expect(denied.native['codex']?.argv).toEqual([
      '--sandbox',
      'read-only',
      '--approval_policy',
      'on-request',
    ]);
  });

  it('allowing execute_commands + network_access empties the claude disallowed list', () => {
    const allowed = compilePolicy(
      policyWith({ execute_commands: 'allow', network_access: 'allow' }),
    );
    expect(allowed.native['claude-code']?.argv).toEqual([]);
  });

  it('zero confirm tiers remaining → codex approval_policy never', () => {
    const allAllow = policyWith(
      Object.fromEntries(
        PERMISSION_TIERS.filter((t) => t !== 'read_files').map((t) => [t, 'allow']),
      ) as Partial<Record<PermissionTier, PolicyMode>>,
    );
    const compiled = compilePolicy(allAllow);
    expect(compiled.native['codex']?.argv).toEqual([
      '--sandbox',
      'workspace-write',
      '--approval_policy',
      'never',
    ]);
  });

  it('every compiled output across the full tier × mode matrix validates', () => {
    for (const tier of PERMISSION_TIERS) {
      for (const mode of ['allow', 'confirm', 'deny'] as const) {
        const compiled = compilePolicy(policyWith({ [tier]: mode }));
        expect(CompiledPolicySchema.safeParse(compiled).success).toBe(true);
      }
    }
  });
});
