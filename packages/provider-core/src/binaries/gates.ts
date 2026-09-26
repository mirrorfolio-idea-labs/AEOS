import type { CapabilityMatrix, HarnessAdapter, SessionHandle, SpawnOptions } from '../adapter.js';
import type { ManagedHarness } from './pins.js';
import { compareVersions } from './versions.js';

export type GatedFeature = Exclude<keyof CapabilityMatrix, 'maxContextTokens'>;

/**
 * Minimum harness version per capability (P2.M7.T2, spec §17.2). Values
 * are the oldest releases each translator was validated against with
 * recorded fixtures — data, not guesses about upstream changelogs. A
 * feature absent here is ungated.
 */
export const CAPABILITY_GATES: Readonly<Record<ManagedHarness, Partial<Record<GatedFeature, string>>>> = {
  'claude-code': { structuredOutput: '1.0.0', resume: '1.0.0', mcp: '1.0.0' },
  // exec --json thread/turn/item shapes + new-thread-id resume (P2.M6 fixtures)
  codex: { structuredOutput: '0.149.0', resume: '0.149.0', sandbox: '0.149.0' },
  // `--session` resume and `--format json` exist from 1.0; ≥1.18 shapes translated additively (D11)
  opencode: { structuredOutput: '1.0.0', resume: '1.0.0' },
};

/** Typed refusal: `feature` needs `required` but the harness runs `actual`. */
export class CapabilityVersionError extends Error {
  readonly code = 'capability_version_unsupported';
  constructor(
    readonly harness: ManagedHarness,
    readonly feature: GatedFeature,
    readonly required: string,
    readonly actual: string,
  ) {
    super(`${harness} ${actual} does not support ${feature} (requires ≥ ${required})`);
    this.name = 'CapabilityVersionError';
  }
}

/**
 * Throws `CapabilityVersionError` when `version` is known and below the
 * gate. Unknown versions (BYO binaries that will not report one) pass:
 * gating is a guard against known-old pins, not a probe of the unknown.
 */
export function assertCapability(harness: ManagedHarness, feature: GatedFeature, version: string | undefined): void {
  const required = CAPABILITY_GATES[harness][feature];
  if (required === undefined || version === undefined) return;
  if (compareVersions(version, required) < 0) {
    throw new CapabilityVersionError(harness, feature, required, version);
  }
}

export function supportsCapability(harness: ManagedHarness, feature: GatedFeature, version: string | undefined): boolean {
  try {
    assertCapability(harness, feature, version);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wrap an adapter so its advertised capabilities reflect the running
 * version and version-gated requests are refused at spawn: resuming on a
 * harness below the `resume` gate throws `CapabilityVersionError` instead
 * of producing a silently fresh session.
 */
export function gateAdapter(
  adapter: HarnessAdapter,
  harness: ManagedHarness,
  version: () => string | undefined,
): HarnessAdapter {
  return {
    get id() {
      return adapter.id;
    },
    capabilities(): CapabilityMatrix {
      const caps = { ...adapter.capabilities() };
      const current = version();
      for (const feature of Object.keys(CAPABILITY_GATES[harness]) as GatedFeature[]) {
        if (caps[feature] === true && !supportsCapability(harness, feature, current)) caps[feature] = false;
      }
      return caps;
    },
    createProfile: (agent) => adapter.createProfile(agent),
    spawn(opts: SpawnOptions): SessionHandle {
      const current = version();
      assertCapability(harness, 'structuredOutput', current);
      if (opts.resumeToken !== undefined) assertCapability(harness, 'resume', current);
      return adapter.spawn(opts);
    },
    translate: (raw) => adapter.translate(raw),
  };
}
