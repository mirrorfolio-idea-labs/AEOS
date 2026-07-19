import { AeosEventSchema, newEventId, type AeosEvent } from '@aeos/contracts';

/**
 * Usage-limit auto-failover hook (spec §9; scoped policy input — the full
 * policy engine is P2.M1). When a session dies on a provider usage limit:
 *
 * - `confirm` → emit an `approval.request` with action
 *   `provider.credential_failover`; the daemon parks the objective in
 *   `waiting_approval` until answered.
 * - `allow` → return a switch decision; the caller rebuilds the profile on
 *   the fallback credential and respawns with the T4 resume path.
 */
export type UsageLimitPolicy = 'confirm' | 'allow';

export const CREDENTIAL_FAILOVER_ACTION = 'provider.credential_failover';

const USAGE_LIMIT_PATTERN = /usage limit/i;

export type FailoverDecision =
  | { kind: 'none' }
  | { kind: 'approval'; event: AeosEvent }
  | { kind: 'switch'; fallbackProfileId: string; resumeToken?: string };

export interface EvaluateUsageLimitOptions {
  policy: UsageLimitPolicy;
  /** Credential profile to fail over to. */
  fallbackProfileId: string;
  /** AEOS session the decision belongs to. */
  sessionId: string;
  /** Resume token captured before the limit hit (SessionHandle.resumeToken). */
  resumeToken?: string;
  /** Approval expiry window; deny-by-default on timeout is the daemon's job. */
  expiresInMs?: number;
  newId?: () => string;
  now?: () => Date;
}

/** True when the translated session ended on a provider usage limit. */
export function isUsageLimitFailure(events: readonly AeosEvent[]): boolean {
  const last = events.at(-1);
  return (
    last?.type === 'session.failed' && USAGE_LIMIT_PATTERN.test(last.payload.reason)
  );
}

export function evaluateUsageLimit(
  events: readonly AeosEvent[],
  opts: EvaluateUsageLimitOptions,
): FailoverDecision {
  if (!isUsageLimitFailure(events)) return { kind: 'none' };

  if (opts.policy === 'allow') {
    return {
      kind: 'switch',
      fallbackProfileId: opts.fallbackProfileId,
      ...(opts.resumeToken === undefined ? {} : { resumeToken: opts.resumeToken }),
    };
  }

  const now = (opts.now ?? (() => new Date()))();
  const expiresAt = new Date(now.getTime() + (opts.expiresInMs ?? 15 * 60 * 1000));
  const event = AeosEventSchema.parse({
    v: 1,
    id: (opts.newId ?? newEventId)(),
    ts: now.toISOString(),
    source: 'provider-claude',
    sessionId: opts.sessionId,
    type: 'approval.request',
    payload: {
      requestId: (opts.newId ?? newEventId)(),
      action: CREDENTIAL_FAILOVER_ACTION,
      detail: `Provider usage limit reached; switch to credential profile "${opts.fallbackProfileId}" and resume?`,
      expiresAt: expiresAt.toISOString(),
    },
  });
  return { kind: 'approval', event };
}
