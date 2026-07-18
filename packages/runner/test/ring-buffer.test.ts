import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../src/runner/ring-buffer.js';

describe('RingBuffer', () => {
  it('assigns monotonically increasing seqs starting at 1', () => {
    const buf = new RingBuffer<string>(4);
    expect(buf.append('a')).toBe(1);
    expect(buf.append('b')).toBe(2);
    expect(buf.lastSeq).toBe(2);
  });

  it('since(seq) returns the retained tail after seq, in order', () => {
    const buf = new RingBuffer<string>(8);
    for (const item of ['a', 'b', 'c', 'd']) buf.append(item);
    expect(buf.since(2)).toEqual([
      { seq: 3, item: 'c' },
      { seq: 4, item: 'd' },
    ]);
    expect(buf.since(0).length).toBe(4);
    expect(buf.since(4)).toEqual([]);
  });

  it('overwrites the oldest entries at capacity without breaking seq continuity', () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 1; i <= 10; i++) buf.append(i);
    expect(buf.lastSeq).toBe(10);
    expect(buf.since(0)).toEqual([
      { seq: 8, item: 8 },
      { seq: 9, item: 9 },
      { seq: 10, item: 10 },
    ]);
    // requesting from inside the retained window works
    expect(buf.since(8).map((e) => e.seq)).toEqual([9, 10]);
  });

  it('property: for random append/since interleavings, since(s) is exactly the retained entries with seq > s', () => {
    let state = 42;
    const rand = () => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state / 2 ** 31;
    };
    for (let round = 0; round < 200; round++) {
      const capacity = 1 + Math.floor(rand() * 16);
      const buf = new RingBuffer<number>(capacity);
      const total = Math.floor(rand() * 64);
      for (let i = 1; i <= total; i++) buf.append(i);
      const from = Math.floor(rand() * (total + 2));
      const expectedFirst = Math.max(from + 1, total - capacity + 1);
      const expected = [];
      for (let s = expectedFirst; s <= total; s++) expected.push({ seq: s, item: s });
      expect(buf.since(from)).toEqual(expected);
    }
  });
});
