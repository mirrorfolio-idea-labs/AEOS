import { describe, expect, it } from 'vitest';
import { EnvelopeBaseSchema, newEventId } from '../src/index.js';

const valid = {
  v: 1,
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  ts: '2026-07-13T10:00:00.000Z',
  source: 'kernel',
  agentId: 'agent-01',
};

describe('EnvelopeBaseSchema', () => {
  it('accepts a valid envelope and round-trips JSON', () => {
    const parsed = EnvelopeBaseSchema.parse(valid);
    expect(EnvelopeBaseSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('rejects a bad ULID id', () => {
    expect(() => EnvelopeBaseSchema.parse({ ...valid, id: 'not-a-ulid!' })).toThrow();
  });

  it('rejects a non-ISO timestamp', () => {
    expect(() => EnvelopeBaseSchema.parse({ ...valid, ts: '13/07/2026' })).toThrow();
  });

  it('rejects an unknown protocol version', () => {
    expect(() => EnvelopeBaseSchema.parse({ ...valid, v: 999 })).toThrow();
  });

  it('newEventId produces valid, monotonically sortable ids', () => {
    const a = newEventId();
    const b = newEventId();
    expect(EnvelopeBaseSchema.shape.id.parse(a)).toBe(a);
    expect(a < b).toBe(true);
  });
});
