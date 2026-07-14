import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AeosEventSchema,
  newEventId,
  type AeosEvent,
  type AgentConfig,
  type SessionRecord,
} from '@aeos/contracts';
import {
  attachTranscriptWriter,
  createEventBus,
  indexAgent,
  indexSession,
  openIndexDb,
  transcriptPath,
  type IndexDb,
} from '../src/index.js';

const S1 = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const S2 = '01ARZ3NDEKTSV4RRFFQ69G5FA1';

function ev(type: 'session.created' | 'session.completed', sessionId: string): AeosEvent {
  return AeosEventSchema.parse({
    v: 1,
    id: newEventId(),
    ts: new Date('2026-07-14T00:00:00Z').toISOString(),
    source: 'kernel-test',
    agentId: 'ada',
    sessionId,
    type,
    payload: {},
  });
}

function msg(text: string, sessionId: string): AeosEvent {
  return AeosEventSchema.parse({
    v: 1,
    id: newEventId(),
    ts: new Date('2026-07-14T00:00:00Z').toISOString(),
    source: 'kernel-test',
    agentId: 'ada',
    sessionId,
    type: 'item.message',
    payload: { role: 'assistant', text },
  });
}

describe('event bus', () => {
  it('delivers in publish order and honors filters', () => {
    const bus = createEventBus();
    const all: string[] = [];
    const sessionOnly: string[] = [];
    const s2Only: string[] = [];
    bus.subscribe({}, (e) => all.push(e.type));
    bus.subscribe({ typePrefix: 'session.' }, (e) => sessionOnly.push(e.type));
    bus.subscribe({ sessionId: S2 }, (e) => s2Only.push(e.type));

    bus.publish(ev('session.created', S1));
    bus.publish(msg('hello', S1));
    bus.publish(ev('session.created', S2));

    expect(all).toEqual(['session.created', 'item.message', 'session.created']);
    expect(sessionOnly).toEqual(['session.created', 'session.created']);
    expect(s2Only).toEqual(['session.created']);
  });

  it('a throwing handler does not break other subscribers and is reported', () => {
    const errors: unknown[] = [];
    const bus = createEventBus({ onHandlerError: (error) => errors.push(error) });
    const seen: string[] = [];
    bus.subscribe({}, () => {
      throw new Error('boom');
    });
    bus.subscribe({}, (e) => seen.push(e.type));

    bus.publish(ev('session.created', S1));
    bus.publish(ev('session.completed', S1));

    expect(seen).toEqual(['session.created', 'session.completed']);
    expect(errors).toHaveLength(2);
  });

  it('publish from inside a handler preserves global order (queue, not recursion)', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe({}, (e) => {
      if (e.type === 'session.created') bus.publish(msg('reaction', S1));
    });
    bus.subscribe({}, (e) => seen.push(e.type));
    bus.publish(ev('session.created', S1));
    expect(seen).toEqual(['session.created', 'item.message']);
  });

  it('unsubscribe stops delivery', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const off = bus.subscribe({}, (e) => seen.push(e.type));
    bus.publish(ev('session.created', S1));
    off();
    bus.publish(ev('session.completed', S1));
    expect(seen).toEqual(['session.created']);
  });
});

describe('transcript writer', () => {
  let home: string;
  let db: IndexDb;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-bus-'));
    db = openIndexDb(home);
    const ada = {
      id: 'ada',
      workspaceId: 'ws1',
      name: 'Ada',
      harness: { provider: 'claude-code' },
      credentialProfileId: 'byok',
    } as AgentConfig;
    indexAgent(db, ada, 0);
    indexSession(db, { id: S1, agentId: 'ada', state: 'running' } as SessionRecord, 0);
    indexSession(db, { id: S2, agentId: 'ada', state: 'running' } as SessionRecord, 0);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('appends session events in publish order; interleaved sessions stay separated', () => {
    const bus = createEventBus();
    attachTranscriptWriter(bus, home, db);

    const sequence = [
      ev('session.created', S1),
      ev('session.created', S2),
      msg('one', S1),
      msg('two', S2),
      msg('three', S1),
      ev('session.completed', S1),
    ];
    for (const e of sequence) bus.publish(e);

    const t1 = fs
      .readFileSync(transcriptPath(home, 'ws1', 'ada', S1), 'utf8')
      .trim()
      .split('\n')
      .map((line) => AeosEventSchema.parse(JSON.parse(line)));
    expect(t1.map((e) => e.type)).toEqual([
      'session.created',
      'item.message',
      'item.message',
      'session.completed',
    ]);
    expect(t1.map((e) => e.sessionId)).toEqual([S1, S1, S1, S1]);

    const t2 = fs
      .readFileSync(transcriptPath(home, 'ws1', 'ada', S2), 'utf8')
      .trim()
      .split('\n')
      .map((line) => AeosEventSchema.parse(JSON.parse(line)));
    expect(t2.map((e) => e.type)).toEqual(['session.created', 'item.message']);
  });

  it('events without a sessionId are not written anywhere', () => {
    const bus = createEventBus();
    attachTranscriptWriter(bus, home, db);
    bus.publish(
      AeosEventSchema.parse({
        v: 1,
        id: newEventId(),
        ts: new Date('2026-07-14T00:00:00Z').toISOString(),
        source: 'kernel-test',
        type: 'session.created',
        payload: {},
      }),
    );
    expect(fs.existsSync(path.join(home, 'workspaces'))).toBe(false);
  });

  it('unresolvable session is reported, not thrown', () => {
    const errors: unknown[] = [];
    const bus = createEventBus({ onHandlerError: (error) => errors.push(error) });
    attachTranscriptWriter(bus, home, db);
    bus.publish(ev('session.created', '01ARZ3NDEKTSV4RRFFQ69G5FA9'));
    expect(errors).toHaveLength(1);
  });
});
