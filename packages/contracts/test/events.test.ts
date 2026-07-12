import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AEOS_EVENT_TYPES, AeosEventSchema, type AeosEvent } from '../src/index.js';

const lines = readFileSync(join(import.meta.dirname, 'fixtures/events.golden.ndjson'), 'utf8')
  .trim().split('\n');

describe('canonical event taxonomy', () => {
  it('parses every golden fixture line', () => {
    for (const line of lines) {
      expect(() => AeosEventSchema.parse(JSON.parse(line)), line).not.toThrow();
    }
  });

  it('the golden file covers every declared event type (exhaustiveness)', () => {
    const seen = new Set(lines.map((l) => (JSON.parse(l) as { type: string }).type));
    expect([...seen].sort()).toEqual([...AEOS_EVENT_TYPES].sort());
  });

  it('rejects unknown event types', () => {
    const base = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(() => AeosEventSchema.parse({ ...base, type: 'session.hacked' })).toThrow();
  });

  it('narrows payload types via the discriminant', () => {
    const ev = AeosEventSchema.parse(JSON.parse(lines[7]!)) as AeosEvent;
    if (ev.type === 'cost.usage') expect(ev.payload.usd).toBeGreaterThan(0);
    else throw new Error('expected cost.usage at line 8');
  });
});
