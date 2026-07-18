import { PROTOCOL_VERSION } from '@aeos/contracts';
import { describe, expect, it } from 'vitest';
import {
  negotiateVersion,
  parseWireMessage,
  VersionMismatchError,
  WireMessageSchema,
} from '../src/protocol/messages.js';

const SESSION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('wire messages', () => {
  it('parses every message kind', () => {
    const samples: unknown[] = [
      { t: 'hello', v: PROTOCOL_VERSION, minV: 1, maxV: 1, sessionId: SESSION_ID },
      { t: 'helloAck', v: PROTOCOL_VERSION, lastSeq: 42 },
      { t: 'heartbeat' },
      { t: 'heartbeat', seq: 7 },
      { t: 'replay', fromSeq: 0 },
      { t: 'stop', reason: 'shutdown' },
      { t: 'protoError', code: 'version_mismatch', message: 'no overlap' },
    ];
    for (const sample of samples) {
      expect(WireMessageSchema.parse(sample)).toEqual(sample);
    }
  });

  it('parses event messages carrying a canonical AeosEvent', () => {
    const msg = {
      t: 'event',
      seq: 3,
      event: {
        v: PROTOCOL_VERSION,
        id: SESSION_ID,
        ts: new Date().toISOString(),
        source: 'runner',
        sessionId: SESSION_ID,
        type: 'item.message',
        payload: { role: 'assistant', text: 'hello' },
      },
    };
    expect(WireMessageSchema.parse(msg)).toEqual(msg);
  });

  it('rejects unknown message kinds and malformed payloads', () => {
    expect(() => WireMessageSchema.parse({ t: 'nope' })).toThrow();
    expect(() => WireMessageSchema.parse({ t: 'replay' })).toThrow(); // missing fromSeq
    expect(() => WireMessageSchema.parse({ t: 'hello', v: 1, minV: 1, maxV: 1 })).toThrow(); // no sessionId
  });

  it('parseWireMessage wraps decoded unknowns with a typed error message', () => {
    expect(() => parseWireMessage({ t: 'garbage' })).toThrow(/wire message/);
    expect(parseWireMessage({ t: 'heartbeat' })).toEqual({ t: 'heartbeat' });
  });
});

describe('version negotiation', () => {
  it('agrees on the highest mutually supported version', () => {
    expect(negotiateVersion({ minV: 1, maxV: 3 }, { minV: 2, maxV: 5 })).toBe(3);
    expect(negotiateVersion({ minV: 1, maxV: 1 }, { minV: 1, maxV: 1 })).toBe(1);
  });

  it('throws VersionMismatchError when ranges do not overlap (accept case)', () => {
    expect(() => negotiateVersion({ minV: 2, maxV: 3 }, { minV: 1, maxV: 1 })).toThrow(
      VersionMismatchError,
    );
    expect(() => negotiateVersion({ minV: 1, maxV: 1 }, { minV: 2, maxV: 3 })).toThrow(
      VersionMismatchError,
    );
  });
});
