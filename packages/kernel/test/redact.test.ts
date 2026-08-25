import { describe, expect, it } from 'vitest';
import type { AeosEvent } from '@aeos/contracts';
import { createEventBus, attachRedaction } from '../src/index.js';

function evt(payload: unknown): AeosEvent {
  return {
    v: 1,
    id: '0'.repeat(26),
    ts: '2026-01-01T00:00:00.000Z',
    source: 'provider-fake',
    sessionId: 's1',
    type: 'item.tool_result',
    payload,
  } as AeosEvent;
}

describe('attachRedaction', () => {
  it('scrubs registered values anywhere in string fields before subscribers see them', () => {
    const inner = createEventBus();
    const bus = attachRedaction(inner, () => ['sk-or-v1-supersecret-value']);
    const seen: AeosEvent[] = [];
    bus.subscribe({}, (e) => seen.push(e));
    bus.publish(
      evt({
        output: 'called with sk-or-v1-supersecret-value and failed',
        nested: { deep: ['sk-or-v1-supersecret-value', { k: 'sk-or-v1-supersecret-value' }] },
        count: 7,
      }),
    );
    const payload = JSON.stringify(seen[0]?.payload);
    expect(payload).not.toContain('sk-or-v1-supersecret-value');
    expect(payload).toContain('[REDACTED]');
    expect(JSON.stringify(seen[0]?.payload)).toContain('"count":7');
  });

  it('re-queries the registry per publish (live updates)', () => {
    const values = new Set<string>();
    const bus = attachRedaction(createEventBus(), () => [...values]);
    const seen: AeosEvent[] = [];
    bus.subscribe({}, (e) => seen.push(e));
    bus.publish(evt({ output: 'CANARY-one-two-three' }));
    values.add('CANARY-one-two-three');
    bus.publish(evt({ output: 'CANARY-one-two-three' }));
    expect(seen[0]?.payload).toMatchObject({ output: 'CANARY-one-two-three' });
    expect(seen[1]?.payload).toMatchObject({ output: '[REDACTED]' });
  });

  it('ignores short values to avoid mangling ordinary text', () => {
    const bus = attachRedaction(createEventBus(), () => ['abc', '12345678']);
    const seen: AeosEvent[] = [];
    bus.subscribe({}, (e) => seen.push(e));
    bus.publish(evt({ output: 'abc 12345678 kept abc intact' }));
    expect(seen[0]?.payload).toMatchObject({ output: 'abc [REDACTED] kept abc intact' });
  });

  it('subscribe/unsubscribe forwards through the wrapper', () => {
    const bus = attachRedaction(createEventBus(), () => []);
    const seen: AeosEvent[] = [];
    const off = bus.subscribe({}, (e) => seen.push(e));
    bus.publish(evt({ a: 1 }));
    off();
    bus.publish(evt({ a: 2 }));
    expect(seen).toHaveLength(1);
  });

  it('events with no matches pass through byte-equal', () => {
    const bus = attachRedaction(createEventBus(), () => ['sk-or-v1-supersecret-value']);
    const seen: AeosEvent[] = [];
    bus.subscribe({}, (e) => seen.push(e));
    const original = evt({ output: 'nothing interesting here' });
    bus.publish(original);
    expect(JSON.stringify(seen[0])).toBe(JSON.stringify(original));
  });
});
