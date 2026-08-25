import { describe, expect, it } from 'vitest';
import type { PolicyFile } from '@aeos/contracts';
import { DEFAULT_POSTURE, mergePolicyLayers } from '../src/index.js';

describe('mergePolicyLayers', () => {
  it('empty stack yields exactly the default posture', () => {
    expect(mergePolicyLayers([])).toEqual(DEFAULT_POSTURE);
    expect(mergePolicyLayers([undefined, undefined])).toEqual(DEFAULT_POSTURE);
  });

  it('workspace layer overrides defaults tier-by-tier', () => {
    const merged = mergePolicyLayers([{ tiers: { git_push: 'deny', deploy: 'deny' } }]);
    expect(merged.tiers.git_push).toBe('deny');
    expect(merged.tiers.deploy).toBe('deny');
    expect(merged.tiers.read_files).toBe(DEFAULT_POSTURE.tiers.read_files);
  });

  it('agent layer wins per-tier while untouched tiers keep workspace values', () => {
    const ws: PolicyFile = { tiers: { git_push: 'deny', deploy: 'deny' } };
    const agent: PolicyFile = { tiers: { git_push: 'allow' } };
    const merged = mergePolicyLayers([ws, agent]);
    expect(merged.tiers.git_push).toBe('allow');
    expect(merged.tiers.deploy).toBe('deny');
  });

  it('objective layer wins on conflict', () => {
    const objective: PolicyFile = { tiers: { network_access: 'allow' } };
    const merged = mergePolicyLayers(
      [{ tiers: { network_access: 'deny' } }, { tiers: { network_access: 'confirm' } }, objective],
    );
    expect(merged.tiers.network_access).toBe('allow');
  });

  it('confirmTimeoutSeconds takes the most-specific non-undefined value', () => {
    expect(mergePolicyLayers([{ confirmTimeoutSeconds: 60 }]).confirmTimeoutSeconds).toBe(60);
    expect(
      mergePolicyLayers([{ confirmTimeoutSeconds: 60 }, { tiers: { git_push: 'deny' } }])
        .confirmTimeoutSeconds,
    ).toBe(60);
    expect(mergePolicyLayers([]).confirmTimeoutSeconds).toBe(
      DEFAULT_POSTURE.confirmTimeoutSeconds,
    );
  });
});
