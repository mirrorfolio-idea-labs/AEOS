import { describe, expect, it } from 'vitest';
import { PolicyFileSchema } from '@aeos/contracts';
import { DEFAULT_POSTURE, mergePolicyLayers, sandboxFor } from '../src/index.js';

describe('sandbox tier selection (P4.M1.T2)', () => {
  it('no sandbox layer → tier none, and the default posture is byte-identical', () => {
    const effective = mergePolicyLayers([undefined, { tiers: { execute_commands: 'allow' } }]);
    expect(effective.sandbox).toBeUndefined();
    expect(sandboxFor(effective, 'implement').tier).toBe('none');
    expect(mergePolicyLayers([])).toEqual(DEFAULT_POSTURE);
  });

  it('fixture: workspace contains everything, agent frees docs, objective re-contains review', () => {
    const workspace = PolicyFileSchema.parse({ sandbox: { tier: 'container', image: 'aeos-runner:local' } });
    const agent = PolicyFileSchema.parse({ sandbox: { classes: { docs: 'none', review: 'none' } } });
    const objective = PolicyFileSchema.parse({ sandbox: { classes: { review: 'container' }, network: 'none' } });
    const effective = mergePolicyLayers([workspace, agent, objective]);
    const matrix = Object.fromEntries((['implement', 'docs', 'review', 'plan'] as const).map((c) => [c, sandboxFor(effective, c).tier]));
    expect(matrix).toEqual({ implement: 'container', docs: 'none', review: 'container', plan: 'container' });
    expect(sandboxFor(effective, 'implement')).toEqual({ tier: 'container', image: 'aeos-runner:local', network: 'none' });
  });

  it('typos are loud (strict schema)', () => {
    expect(() => PolicyFileSchema.parse({ sandbox: { teir: 'container' } })).toThrow();
    expect(() => PolicyFileSchema.parse({ sandbox: { tier: 'vm' } })).toThrow();
    expect(() => PolicyFileSchema.parse({ sandbox: { classes: { dance: 'none' } } })).toThrow();
  });
});
