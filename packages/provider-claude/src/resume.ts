import type { HarnessProfile, SpawnOptions } from '@aeos/provider-core';

export interface ResumeSpec {
  /**
   * Rebuilt hermetic profile — rebuild with a different CredentialProfile to
   * switch credentials: the switch takes effect on this spawn, never
   * mid-process (spec §9), and cost.usage events carry the new profile id.
   */
  profile: HarnessProfile;
  /** Fresh AEOS session ULID for the resumed run. */
  sessionId: string;
  objective: string;
  /** Provider session id captured from the previous run (`SessionHandle.resumeToken`). */
  resumeToken: string;
}

/**
 * Build the SpawnOptions for continuing a previous provider session
 * (`--resume <token>`), typically stored as `providerSessionId` in
 * `session.yaml` between runs.
 */
export function buildResumeSpawn(spec: ResumeSpec): SpawnOptions {
  if (spec.resumeToken.trim().length === 0) {
    throw new Error('resumeToken must be a non-empty provider session id');
  }
  return {
    profile: spec.profile,
    sessionId: spec.sessionId,
    objective: spec.objective,
    resumeToken: spec.resumeToken,
  };
}
