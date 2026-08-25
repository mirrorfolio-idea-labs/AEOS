import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AEOS_EVENT_TYPES,
  AeosEventSchema,
  PERMISSION_TIERS,
  PolicyFileSchema,
} from '../src/index.js';

describe('policy schemas', () => {
  it('declares the nine spec §11 tiers in order', () => {
    expect(PERMISSION_TIERS).toEqual([
      'read_files',
      'write_files',
      'execute_commands',
      'install_packages',
      'git_commit',
      'git_push',
      'deploy',
      'secrets_access',
      'network_access',
    ]);
  });

  it('parses a partial policy layer and defaults cleanly', () => {
    const parsed = PolicyFileSchema.parse({ tiers: { git_push: 'deny' } });
    expect(parsed.tiers?.git_push).toBe('deny');
    expect(PolicyFileSchema.parse({}).tiers).toBeUndefined();
  });

  it('rejects unknown tiers, unknown modes, and stray keys', () => {
    expect(() => PolicyFileSchema.parse({ tiers: { kernel_hack: 'allow' } })).toThrow();
    expect(() => PolicyFileSchema.parse({ tiers: { git_push: 'maybe' } })).toThrow();
    expect(() => PolicyFileSchema.parse({ tiers: {}, inlineSecret: 'x' })).toThrow();
  });

  it('parses confirmTimeoutSeconds as a positive integer', () => {
    expect(PolicyFileSchema.parse({ confirmTimeoutSeconds: 30 }).confirmTimeoutSeconds).toBe(30);
    expect(() => PolicyFileSchema.parse({ confirmTimeoutSeconds: 0 })).toThrow();
    expect(() => PolicyFileSchema.parse({ confirmTimeoutSeconds: 1.5 })).toThrow();
  });
});

describe('policy/approval event types in the canonical taxonomy', () => {
  const lines = readFileSync(join(import.meta.dirname, 'fixtures/events.golden.ndjson'), 'utf8')
    .trim()
    .split('\n');

  const base = {
    v: 1,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
    ts: '2026-08-25T00:00:00.000Z',
    source: 'policy',
    sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
  };

  it('parses approval.resolved and policy.blocked events', () => {
    expect(
      AeosEventSchema.parse({
        ...base,
        type: 'approval.resolved',
        payload: { requestId: 'a1', decision: 'approved', by: 'kabeer' },
      }).type,
    ).toBe('approval.resolved');
    expect(
      AeosEventSchema.parse({
        ...base,
        type: 'policy.blocked',
        payload: { tier: 'git_push', tool: 'Bash', detail: 'blocked by policy' },
      }).type,
    ).toBe('policy.blocked');
  });

  it('rejects invalid decision/tier payloads on the new types', () => {
    expect(() =>
      AeosEventSchema.parse({
        ...base,
        type: 'approval.resolved',
        payload: { requestId: 'a1', decision: 'shrug', by: 'kabeer' },
      }),
    ).toThrow();
    expect(() =>
      AeosEventSchema.parse({
        ...base,
        type: 'policy.blocked',
        payload: { tier: 'not_a_tier', tool: 'Bash', detail: 'x' },
      }),
    ).toThrow();
  });

  it('keeps the golden fixture exhaustive over the declared type set', () => {
    const seen = new Set(lines.map((l) => (JSON.parse(l) as { type: string }).type));
    for (const t of ['approval.resolved', 'policy.blocked']) {
      expect(seen.has(t)).toBe(true);
    }
    expect(seen.size).toBe(AEOS_EVENT_TYPES.length);
  });
});
