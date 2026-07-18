import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  InvalidTransitionError,
  type AeosEvent,
  type AgentConfig,
  type SessionState,
} from '@aeos/contracts';
import {
  createAgent,
  createEventBus,
  createWorkspace,
  openIndexDb,
  querySessions,
  readSessionYaml,
  sessionYaml,
  writeSessionYaml,
  type EventBus,
  type IndexDb,
} from '@aeos/kernel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transitionSession } from '../src/supervisor/session-state.js';

const WS = 'ws1';
const AGENT = 'ada';
const SID = '01ARZ3NDEKTSV4RRFFQ69G5FC1';

describe('transitionSession — the single state-change code path (M3.T4)', () => {
  let home: string;
  let db: IndexDb;
  let bus: EventBus;
  let events: AeosEvent[];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-state-'));
    db = openIndexDb(home);
    bus = createEventBus();
    events = [];
    bus.subscribe({}, (e) => events.push(e));
    createWorkspace(home, { id: WS, name: 'WS One' });
    createAgent(home, db, {
      id: AGENT,
      workspaceId: WS,
      name: 'Ada',
      harness: { provider: 'claude-code' },
      credentialProfileId: 'byok',
    } as AgentConfig);
    fs.mkdirSync(path.dirname(sessionYaml(home, WS, AGENT, SID)), { recursive: true });
    writeSessionYaml(home, WS, AGENT, SID, { id: SID, agentId: AGENT, state: 'created' });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function step(to: SessionState) {
    return transitionSession({ home, db, bus, workspaceId: WS, agentId: AGENT, sessionId: SID, to });
  }

  it('walks the full legal path, persisting session.yaml at every step', () => {
    for (const to of ['starting', 'running', 'completed'] as const) {
      const record = step(to);
      expect(record.state).toBe(to);
      // read the file back each time: disk state === in-memory state
      expect(readSessionYaml(home, WS, AGENT, SID).state).toBe(to);
    }
  });

  it('emits session.state_changed events in order with correct from/to payloads', () => {
    step('starting');
    step('running');
    step('paused');
    step('running');
    const changes = events
      .filter((e) => e.type === 'session.state_changed')
      .map((e) => e.payload as { from: string; to: string });
    expect(changes).toEqual([
      { from: 'created', to: 'starting' },
      { from: 'starting', to: 'running' },
      { from: 'running', to: 'paused' },
      { from: 'paused', to: 'running' },
    ]);
  });

  it('rejects illegal jumps with InvalidTransitionError and leaves state untouched', () => {
    const illegal: SessionState[] = ['running', 'completed', 'paused', 'orphaned'];
    for (const to of illegal) {
      expect(() => step(to)).toThrow(InvalidTransitionError);
      expect(readSessionYaml(home, WS, AGENT, SID).state).toBe('created');
    }
    expect(events.filter((e) => e.type === 'session.state_changed')).toHaveLength(0);
  });

  it('terminal states accept no further transitions', () => {
    step('starting');
    step('running');
    step('completed');
    for (const to of ['running', 'failed', 'orphaned'] as const) {
      expect(() => step(to)).toThrow(InvalidTransitionError);
    }
    expect(readSessionYaml(home, WS, AGENT, SID).state).toBe('completed');
  });

  it('upserts the derived index on every accepted transition', () => {
    step('starting');
    step('running');
    const row = querySessions(db).find((r) => r.id === SID);
    expect(row?.state).toBe('running');
  });

  it('re-adoption path: orphaned → running is legal (spec §10)', () => {
    step('starting');
    step('running');
    step('orphaned');
    const record = step('running');
    expect(record.state).toBe('running');
    expect(readSessionYaml(home, WS, AGENT, SID).state).toBe('running');
  });

  it('preserves runner metadata fields across transitions', () => {
    writeSessionYaml(home, WS, AGENT, SID, {
      id: SID,
      agentId: AGENT,
      state: 'created',
      runnerPid: 4242,
      runnerSocket: '/tmp/x.sock',
    });
    const record = step('starting');
    expect(record.runnerPid).toBe(4242);
    expect(record.runnerSocket).toBe('/tmp/x.sock');
  });
});
