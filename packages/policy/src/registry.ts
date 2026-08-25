import { newEventId } from '@aeos/contracts';
import type { PermissionTier } from '@aeos/contracts';

/**
 * In-memory approvals registry (spec §11 approval flow). The durable record
 * of every request/outcome is the canonical event stream itself
 * (`approval.request` / `approval.resolved` land in transcript.ndjson); this
 * registry only tracks LIVE requests. A daemon crash orphans them by design:
 * sessions re-guard from scratch on resume.
 */

export interface PendingApproval {
  requestId: string;
  sessionId: string;
  tier: PermissionTier;
  detail: string;
  status: 'pending';
  createdAt: string;
  expiresAt: string;
}

export type ApprovalDecision = 'approve' | 'deny';
export type ApprovalOutcome = 'approved' | 'denied' | 'expired';

export interface ApprovalRequestHandle {
  requestId: string;
  /** ISO timestamp mirroring the `approval.request` payload. */
  expiresAt: string;
  /** Settles exactly once — externally, or by timeout-deny (spec default). */
  outcome: Promise<{ decision: ApprovalOutcome; by: string }>;
}

export interface ApprovalsRegistry {
  request(input: {
    sessionId: string;
    tier: PermissionTier;
    detail: string;
    /** Absolute epoch-ms deadline; omit to use the configured default. */
    expiresAtMs?: number;
  }): ApprovalRequestHandle;
  /** Human/automation answer. Throws on unknown or already-settled ids. */
  resolve(requestId: string, decision: ApprovalDecision, by: string): void;
  pending(): PendingApproval[];
}

const DEFAULT_TIMEOUT_MS = 300_000;

export function createApprovalsRegistry(
  options: { defaultTimeoutMs?: number } = {},
): ApprovalsRegistry {
  interface Entry {
    record: PendingApproval;
    settle: (outcome: { decision: ApprovalOutcome; by: string }) => void;
    timer: NodeJS.Timeout;
  }
  const live = new Map<string, Entry>();

  return {
    request(input): ApprovalRequestHandle {
      const createdAt = Date.now();
      const expiresAtMs =
        input.expiresAtMs ?? createdAt + (options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS);
      const handle: PendingApproval = {
        requestId: newEventId(),
        sessionId: input.sessionId,
        tier: input.tier,
        detail: input.detail,
        status: 'pending',
        createdAt: new Date(createdAt).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
      let settle!: Entry['settle'];
      const outcome = new Promise<{ decision: ApprovalOutcome; by: string }>((resolve) => {
        settle = resolve;
      });
      const timer = setTimeout(() => {
        if (live.has(handle.requestId)) {
          live.delete(handle.requestId);
          settle({ decision: 'expired', by: 'timeout' }); // deny-by-default (spec §11)
        }
      }, Math.max(0, expiresAtMs - createdAt));
      timer.unref?.();
      live.set(handle.requestId, { record: handle, settle, timer });
      return {
        requestId: handle.requestId,
        expiresAt: handle.expiresAt,
        outcome: outcome.then((resolved) => {
          clearTimeout(timer);
          return resolved;
        }),
      };
    },
    resolve(requestId, decision, by): void {
      const entry = live.get(requestId);
      if (entry === undefined) {
        throw new Error(`unknown or settled approval request "${requestId}"`);
      }
      live.delete(requestId);
      entry.settle({
        decision: decision === 'approve' ? 'approved' : 'denied',
        by: by.length > 0 ? by : 'unknown',
      });
    },
    pending(): PendingApproval[] {
      return [...live.values()].map((e) => e.record);
    },
  };
}
