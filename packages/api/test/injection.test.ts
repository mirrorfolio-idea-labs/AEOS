import { describe, expect, it } from 'vitest';
import { AgentConfigSchema, type EffectivePolicy } from '@aeos/contracts';
import type { CapabilityMatrix, HarnessAdapter, SessionHandle } from '@aeos/provider-core';
import { guardAdapter } from '../src/policy-gate.js';

function agentWith(secrets?: string[]) {
  return AgentConfigSchema.parse({
    id: 'agent-a',
    workspaceId: 'ws',
    name: 'Agent A',
    harness: { provider: 'claude-code', featureToggles: {} },
    credentialProfileId: 'cp',
    ...(secrets === undefined ? {} : { secrets }),
  });
}

function policyFor(tier: 'allow' | 'confirm' | 'deny' | undefined): EffectivePolicy {
  return {
    tiers: {
      read_files: 'allow',
      write_files: 'allow',
      execute_commands: 'deny',
      install_packages: 'deny',
      git_commit: 'deny',
      git_push: 'deny',
      deploy: 'deny',
      network_access: 'deny',
      secrets_access: tier ?? 'deny',
    },
    confirmTimeoutSeconds: 60,
  };
}

/** Records the env of every profile that reaches a real spawn. */
function capturingAdapter(): { adapter: HarnessAdapter; spawnedEnv: () => Record<string, string> } {
  let launched: Record<string, string> = {};
  const caps: CapabilityMatrix = {
    resume: false,
    structuredOutput: false,
    mcp: false,
    sandbox: false,
    costReporting: false,
  };
  const handle: SessionHandle = {
    events: (async function* () {})(),
    providerSessionId: undefined,
    resumeToken: undefined,
    costUsd: undefined,
    kill: () => undefined,
  };
  const adapter: HarnessAdapter = {
    id: 'capturing',
    capabilities: () => caps,
    createProfile: async () => ({ rootDir: '/tmp/capturing', env: {}, argv: [] }),
    spawn: (opts) => {
      launched = { ...opts.profile.env };
      return handle;
    },
    translate: () => [],
  };
  return { adapter, spawnedEnv: () => launched };
}

/** Mirrors the daemon injector: only DECLARED refs ever resolve. */
const inject = async (agent: ReturnType<typeof agentWith>): Promise<Record<string, string>> =>
  Object.fromEntries(
    (agent.secrets ?? [])
      .filter((ref) => ref === 'api-token')
      .map((ref) => ['AEOS_SECRET_API_TOKEN', 'value-for-agent']),
  );

describe('policy-gated secret injection', () => {
  it('injects declared refs into the launch env only under allow', async () => {
    const { adapter, spawnedEnv } = capturingAdapter();
    const guarded = guardAdapter(adapter, policyFor('allow'), { inject });
    const profile = await guarded.createProfile(agentWith(['api-token']));
    expect(profile.env['AEOS_SECRET_API_TOKEN']).toBe('value-for-agent');
    guarded.spawn({ profile, sessionId: 's', objective: 'o' });
    expect(spawnedEnv()['AEOS_SECRET_API_TOKEN']).toBe('value-for-agent');
  });

  it('denies injection under confirm and deny tiers and under default posture', async () => {
    for (const tier of ['confirm', 'deny', undefined] as const) {
      const { adapter, spawnedEnv } = capturingAdapter();
      const options = tier === undefined ? undefined : { inject };
      const guarded = guardAdapter(adapter, policyFor(tier), options);
      const profile = await guarded.createProfile(agentWith(['api-token']));
      expect(profile.env['AEOS_SECRET_API_TOKEN'], `tier=${tier}`).toBeUndefined();
      guarded.spawn({ profile, sessionId: 's', objective: 'o' });
      expect(spawnedEnv()['AEOS_SECRET_API_TOKEN'], `tier=${tier}`).toBeUndefined();
    }
  });

  it('injects nothing when the agent declares no refs, even under allow', async () => {
    const { adapter, spawnedEnv } = capturingAdapter();
    const guarded = guardAdapter(adapter, policyFor('allow'), { inject });
    const profile = await guarded.createProfile(agentWith());
    guarded.spawn({ profile, sessionId: 's', objective: 'o' });
    expect(Object.keys(spawnedEnv()).filter((k) => k.startsWith('AEOS_SECRET_'))).toEqual([]);
  });
});
