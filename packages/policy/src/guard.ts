import { AeosEventSchema, newEventId, type AeosEvent, type EffectivePolicy } from '@aeos/contracts';
import type { ApprovalsRegistry } from './registry.js';
import { classifyToolCall } from './classify.js';

export interface SessionGuardOptions {
  effective: EffectivePolicy;
  /**
   * Required for `confirm` tiers. Without it, confirm degrades to deny —
   * fail-closed: an unwired registry can never silently approve anything.
   */
  registry?: ApprovalsRegistry;
}

function policyEvent(sessionId: string | undefined, payload: {
  tier: string;
  tool: string;
  detail: string;
}): AeosEvent {
  return AeosEventSchema.parse({
    v: 1,
    id: newEventId(),
    ts: new Date().toISOString(),
    source: 'policy',
    ...(sessionId === undefined ? {} : { sessionId }),
    type: 'policy.blocked',
    payload,
  });
}

function failedResult(sessionId: string | undefined, callId: string, tier: string): AeosEvent {
  return AeosEventSchema.parse({
    v: 1,
    id: newEventId(),
    ts: new Date().toISOString(),
    source: 'policy',
    ...(sessionId === undefined ? {} : { sessionId }),
    type: 'item.tool_result',
    payload: { callId, ok: false, output: `blocked by policy: ${tier}` },
  });
}

/**
 * Daemon-side enforcement over one session's canonical event stream
 * (spec §11 defense-in-depth). Per `item.tool_call`:
 * - `allow`   → passes through untouched
 * - `deny`    → call suppressed; `policy.blocked` + failed tool_result yielded
 * - `confirm` → `approval.request` yielded, stream parks until the registry
 *               settles; approved ⇒ the original call flows on; denied/expired
 *               ⇒ same path as deny (with an `approval.resolved` first).
 *
 * Synthetic events are YIELDED into the stream rather than side-published so
 * transcript, SSE, and any downstream consumer observe one ordered reality.
 */
export function createSessionGuard(options: SessionGuardOptions) {
  return (events: AsyncIterable<AeosEvent>): AsyncIterable<AeosEvent> =>
    guardStream(events, options);
}

async function* guardStream(
  events: AsyncIterable<AeosEvent>,
  options: SessionGuardOptions,
): AsyncGenerator<AeosEvent, void, undefined> {
  const { effective, registry } = options;
  for await (const event of events) {
    if (event.type !== 'item.tool_call') {
      yield event;
      continue;
    }
    const tier = classifyToolCall(event.payload.tool, event.payload.input);
    const mode = effective.tiers[tier];
    if (mode === 'allow') {
      yield event;
      continue;
    }

    if (mode === 'deny' || registry === undefined) {
      yield policyEvent(event.sessionId, {
        tier,
        tool: event.payload.tool,
        detail: mode === 'deny' ? 'mode=deny' : 'mode=confirm but no approvals registry wired',
      });
      yield failedResult(event.sessionId, event.payload.callId, tier);
      continue;
    }

    const request = registry.request({
      sessionId: event.sessionId ?? '',
      tier,
      detail: `${event.payload.tool}: ${JSON.stringify(event.payload.input).slice(0, 200)}`,
    });
    yield AeosEventSchema.parse({
      v: 1,
      id: newEventId(),
      ts: new Date().toISOString(),
      source: 'policy',
      ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
      type: 'approval.request',
      payload: {
        requestId: request.requestId,
        action: tier,
        detail: `${event.payload.tool}: ${JSON.stringify(event.payload.input).slice(0, 200)}`,
        expiresAt: request.expiresAt,
      },
    });

    const outcome = await request.outcome;
    yield AeosEventSchema.parse({
      v: 1,
      id: newEventId(),
      ts: new Date().toISOString(),
      source: 'policy',
      ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
      type: 'approval.resolved',
      payload: { requestId: request.requestId, decision: outcome.decision, by: outcome.by },
    });

    if (outcome.decision === 'approved') {
      yield event;
      continue;
    }
    yield policyEvent(event.sessionId, {
      tier,
      tool: event.payload.tool,
      detail: `approval ${outcome.decision}`,
    });
    yield failedResult(event.sessionId, event.payload.callId, tier);
  }
}
