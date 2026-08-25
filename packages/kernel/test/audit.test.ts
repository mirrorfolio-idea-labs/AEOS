import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AeosEventSchema, newEventId, type AeosEvent } from '@aeos/contracts';
import { attachAuditWriter, createEventBus } from '../src/index.js';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-audit-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function event(type: AeosEvent['type'], ts: string, payload: Record<string, unknown> = {}): AeosEvent {
  return AeosEventSchema.parse({
    v: 1,
    id: newEventId(),
    ts,
    source: 'audit-test',
    type,
    payload,
  });
}

describe('append-only audit writer (P2.M2.T3)', () => {
  it('writes one NDJSON line per audited class into the UTC-day file', () => {
    const bus = createEventBus();
    const detach = attachAuditWriter(bus, home);

    bus.publish(event('item.tool_call', '2026-08-25T10:00:00.000Z', { callId: 'c1', tool: 'Bash', input: {} }));
    bus.publish(event('cost.usage', '2026-08-25T10:00:01.000Z', { profileId: 'cp', usd: 0.01, inputTokens: 1, outputTokens: 2 }));
    // unaudited classes must NOT land
    bus.publish(event('turn.started', '2026-08-25T10:00:02.000Z', { turn: 1 }));
    detach();

    const file = path.join(home, 'audit', 'audit-2026-08-25.ndjson');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!) as { type: string; auditVersion: number };
    expect(first.type).toBe('item.tool_call');
    expect(first.auditVersion).toBe(1);
  });

  it('is append-only: pre-existing content is byte-preserved as events keep flowing', async () => {
    const bus = createEventBus();
    const dayFile = path.join(home, 'audit', 'audit-2026-08-25.ndjson');
    fs.mkdirSync(path.dirname(dayFile), { recursive: true });
    const preExisting = '{"tamper-evident":"seed line"}\n';
    fs.writeFileSync(dayFile, preExisting);

    const detach = attachAuditWriter(bus, home);
    for (let i = 0; i < 5; i++) {
      bus.publish(event('policy.blocked', `2026-08-25T11:00:0${i}.000Z`, { tier: 'git_push', tool: 'Bash', detail: 'x' }));
    }
    detach();

    const text = fs.readFileSync(dayFile, 'utf8');
    expect(text.startsWith(preExisting)).toBe(true);
    expect(text.trim().split('\n')).toHaveLength(6);
  });

  it('date rollover starts a new file and never touches the previous day', () => {
    const bus = createEventBus();
    const detach = attachAuditWriter(bus, home);
    bus.publish(event('session.created', '2026-08-25T23:59:59.000Z'));
    bus.publish(event('session.completed', '2026-08-26T00:00:01.000Z'));
    detach();

    const day1 = fs.readFileSync(path.join(home, 'audit', 'audit-2026-08-25.ndjson'), 'utf8');
    const day2 = fs.readFileSync(path.join(home, 'audit', 'audit-2026-08-26.ndjson'), 'utf8');
    expect(day1.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(day2).type).toBe('session.completed');
  });

  it('covers the approval/policy/budget/memory classes end-to-end', () => {
    const bus = createEventBus();
    const detach = attachAuditWriter(bus, home);
    for (const [type, payload] of [
      ['approval.request', { requestId: 'r1', action: 'git_push', detail: 'd', expiresAt: '2026-08-26T00:00:00.000Z' }],
      ['approval.resolved', { requestId: 'r1', decision: 'denied', by: 'kabeer' }],
      ['policy.blocked', { tier: 'git_push', tool: 'Bash', detail: 'x' }],
      ['budget.exceeded', { scope: 'objective', id: 'o1', kind: 'usd', cap: 0.01, spent: 0.02 }],
      ['memory.written', { path: 'lessons/x.md', bytes: 10 }],
    ] as const) {
      bus.publish(event(type, '2026-08-25T12:00:00.000Z', payload));
    }
    detach();

    const lines = fs.readFileSync(path.join(home, 'audit', 'audit-2026-08-25.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => (JSON.parse(l) as { type: string }).type);
    expect(lines).toEqual([
      'approval.request',
      'approval.resolved',
      'policy.blocked',
      'budget.exceeded',
      'memory.written',
    ]);
  });
});
