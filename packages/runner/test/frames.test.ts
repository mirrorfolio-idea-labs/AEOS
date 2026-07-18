import { describe, expect, it } from 'vitest';
import { encodeFrame, FrameDecoder, FrameSizeError, MAX_FRAME_BYTES } from '../src/protocol/frames.js';

/** Deterministic PRNG (mulberry32) — seed printed on failure per the plan. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMessage(rand: () => number, i: number): unknown {
  const kinds: unknown[] = [
    { t: 'heartbeat' },
    { t: 'event', seq: i, event: { type: 'item.message', text: 'x'.repeat(Math.floor(rand() * 200)) } },
    { t: 'replay', fromSeq: Math.floor(rand() * 1000) },
    { t: 'stop', reason: `reason-${i}` },
    { t: 'hello', v: 1, minV: 1, maxV: 1, sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
  ];
  return kinds[Math.floor(rand() * kinds.length)];
}

describe('framed codec', () => {
  it('round-trips a single frame', () => {
    const decoder = new FrameDecoder();
    const out = decoder.push(encodeFrame({ t: 'heartbeat' }));
    expect(out).toEqual([{ t: 'heartbeat' }]);
  });

  it('decodes a frame split across arbitrary chunk boundaries', () => {
    const frame = encodeFrame({ t: 'stop', reason: 'bye' });
    const decoder = new FrameDecoder();
    const out: unknown[] = [];
    for (let i = 0; i < frame.length; i++) {
      out.push(...decoder.push(frame.subarray(i, i + 1)));
    }
    expect(out).toEqual([{ t: 'stop', reason: 'bye' }]);
  });

  it('decodes multiple frames merged into one chunk', () => {
    const merged = Buffer.concat([
      encodeFrame({ t: 'heartbeat' }),
      encodeFrame({ t: 'replay', fromSeq: 7 }),
    ]);
    const decoder = new FrameDecoder();
    expect(decoder.push(merged)).toEqual([{ t: 'heartbeat' }, { t: 'replay', fromSeq: 7 }]);
  });

  it('fuzz: random message sequences re-chunked at random boundaries decode identically', () => {
    const ITERATIONS = 1000;
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const seed = 0x9e3779b9 ^ iter;
      const rand = mulberry32(seed);
      const count = 1 + Math.floor(rand() * 8);
      const messages = Array.from({ length: count }, (_, i) => randomMessage(rand, i));
      const wire = Buffer.concat(messages.map((m) => encodeFrame(m)));

      // re-chunk at random boundaries (including empty and merged chunks)
      const chunks: Buffer[] = [];
      let offset = 0;
      while (offset < wire.length) {
        const size = 1 + Math.floor(rand() * (wire.length - offset));
        chunks.push(wire.subarray(offset, offset + size));
        offset += size;
      }

      const decoder = new FrameDecoder();
      const decoded = chunks.flatMap((c) => decoder.push(c));
      try {
        expect(decoded).toEqual(messages);
      } catch (error) {
        throw new Error(`fuzz failure at iteration ${iter} (seed ${seed}): ${String(error)}`);
      }
    }
  });

  it('rejects frames over the size limit with FrameSizeError on encode', () => {
    expect(() => encodeFrame({ t: 'event', blob: 'x'.repeat(MAX_FRAME_BYTES) })).toThrow(FrameSizeError);
  });

  it('rejects oversize length prefixes with FrameSizeError on decode', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_FRAME_BYTES + 1);
    const decoder = new FrameDecoder();
    expect(() => decoder.push(header)).toThrow(FrameSizeError);
  });
});
