import { describe, expect, it } from 'vitest';
import type { AeosEvent, EffectivePolicy } from '@aeos/contracts';
import { DEFAULT_POSTURE } from '../src/index.js';
import { createApprovalsRegistry } from '../src/index.js';
import { createSessionGuard } from '../src/index.js';

function policyWith(
  tiers: Partial<Record<string, 'allow' | 'confirm' | 'deny'>>,
): EffectivePolicy {
  return {
    tiers: { ...DEFAULT_POSTURE.tiers, ...tiers },
    confirmTimeoutSeconds: 300,
  } as EffectivePolicy;
}

const TOOL_CALL: AeosEvent = {
  v: 1,
  id: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  ts: '2026-08-25T00:00:00.000Z',
  source: 'provider-fake',
  sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
  type: 'item.tool_call',
  payload: { callId: 'c1', tool: 'Bash', input: { command: 'git push origin main' } },
};

async function* streamOf(...events: AeosEvent[]): AsyncIterable<AeosEvent> {
  for (const event of events) yield event;
}

async function collect(events: AsyncIterable<AeosEvent>): Promise<AeosEvent[]> {
  const out: AeosEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('session guard', () => {
  it('passes allowed tiers through untouched', async () => {
    const guard = createSessionGuard({ effective: policyWith({ git_push: 'allow' }) });
    const events = await collect(guard(streamOf(TOOL_CALL)));
    expect(events).toEqual([TOOL_CALL]);
  });

  it('deny suppresses the call and yields policy.blocked + failed tool_result', async () => {
    const guard = createSessionGuard({ effective: policyWith({ git_push: 'deny' }) });
    const events = await collect(guard(streamOf(TOOL_CALL)));
    expect(events.map((e) => e.type)).toEqual(['policy.blocked', 'item.tool_result']);
    const result = events[1] as Extract<AeosEvent, { type: 'item.tool_result' }>;
    expect(result.payload.callId).toBe('c1');
    expect(result.payload.ok).toBe(false);
    expect(result.payload.output).toContain('git_push');
  });

  it('confirm parks the stream; on approval, resolved event then the original call flow', async () => {
    const registry = createApprovalsRegistry();
    const guard = createSessionGuard({
      effective: policyWith({ git_push: 'confirm' }),
      registry,
    });

    const iterator = guard(streamOf(TOOL_CALL))[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value?.type === 'approval.request').toBe(true);
    const requestId =
      first.value?.type === 'approval.request' ? first.value.payload.requestId : undefined;

    // stream parks while the request sits pending in the registry
    expect(registry.pending()).toHaveLength(1);

    registry.resolve(requestId!, 'approve', 'kabeer');
    const events: AeosEvent[] = [];
    let next = await iterator.next();
    while (!next.done) {
      events.push(next.value);
      next = await iterator.next();
    }
    expect(events.map((e) => e.type)).toEqual(['approval.resolved', 'item.tool_call']);
    expect(events[1]).toEqual(TOOL_CALL);
  }, 5_000);

  it('confirm denied takes the deny path with an approval.resolved event', async () => {
    const registry = createApprovalsRegistry();
    const guard = createSessionGuard({
      effective: policyWith({ git_push: 'confirm' }),
      registry,
    });
    const iterator = guard(streamOf(TOOL_CALL))[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.value?.type !== 'approval.request') throw new Error('expected approval.request');
    registry.resolve(first.value.payload.requestId, 'deny', 'kabeer');
    const events: AeosEvent[] = [first.value as AeosEvent];
    let next = await iterator.next();
    while (!next.done) {
      events.push(next.value);
      next = await iterator.next();
    }
    expect(events.map((e) => e.type)).toEqual([
      'approval.request',
      'approval.resolved',
      'policy.blocked',
      'item.tool_result',
    ]);
  }, 5_000);

  it('confirm expires by timeout → deny-by-default', async () => {
    const registry = createApprovalsRegistry({ defaultTimeoutMs: 20 });
    const guard = createSessionGuard({
      effective: policyWith({ git_push: 'confirm' }),
      registry,
    });
    const types: string[] = [];
    for await (const event of guard(streamOf(TOOL_CALL))) {
      types.push(event.type);
      if (event.type === 'approval.resolved') {
        expect(event.payload.decision).toBe('expired');
      }
    }
    expect(types).toEqual([
      'approval.request',
      'approval.resolved',
      'policy.blocked',
      'item.tool_result',
    ]);
    expect(registry.pending()).toHaveLength(0);
  }, 5_000);

  it('confirm without a registry degrades to deny (fail-closed)', async () => {
    const guard = createSessionGuard({ effective: policyWith({ git_push: 'confirm' }) });
    const events = await collect(guard(streamOf(TOOL_CALL)));
    expect(events.map((e) => e.type)).toEqual(['policy.blocked', 'item.tool_result']);
  });
});
