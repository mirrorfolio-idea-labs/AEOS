import { describe, expect, it } from 'vitest';
import { EffectivePolicySchema } from '@aeos/contracts';
import { FakeAdapter, buildFixtureEvents } from '@aeos/provider-core';
import { DEFAULT_POSTURE } from '@aeos/policy';
import { guardAdapter } from '../src/policy-gate.js';

describe('guardAdapter handle delegation (regression)', () => {
  it('keeps resumeToken / providerSessionId / costUsd live through the policy wrapper', async () => {
    const allowAll = EffectivePolicySchema.parse({
      ...DEFAULT_POSTURE,
      tiers: Object.fromEntries(Object.keys(DEFAULT_POSTURE.tiers).map((t) => [t, 'allow'])),
    });
    const guarded = guardAdapter(
      new FakeAdapter({ providerSessionId: 'ses_resume', events: buildFixtureEvents({ profileId: 'cp' }) }),
      allowAll,
    );
    const profile = { rootDir: '/tmp', env: {}, argv: [] };
    const handle = guarded.spawn({ profile, sessionId: 's1', objective: 'o' });
    expect(handle.resumeToken).toBeUndefined(); // not known until the stream runs
    for await (const _event of handle.events) {
      // drain
    }
    // before the fix the wrapper spread the handle at spawn time, so these
    // stayed undefined forever and checkpoints never recorded a resume token
    expect(handle.resumeToken).toBe('ses_resume');
    expect(handle.providerSessionId).toBe('ses_resume');
  });
});
