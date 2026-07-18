import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AeosEvent, AgentConfig } from '@aeos/contracts';
import {
  createAgent,
  createEventBus,
  createWorkspace,
  openIndexDb,
  readSessionYaml,
  transcriptPath,
  type EventBus,
  type IndexDb,
} from '@aeos/kernel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSupervisor, type Supervisor } from '../src/supervisor/supervisor.js';

const RUNNER_MAIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'runner',
  'main.js',
);

const WS = 'ws1';
const AGENT = 'ada';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(cond: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(25);
  }
}

/** Child printing line-1..line-N, one every `everyMs` ms. */
function countingChild(lines: number, everyMs: number): string[] {
  return [
    process.execPath,
    '-e',
    `let i=0; const t=setInterval(()=>{console.log('line-'+(++i)); if(i>=${lines}) clearInterval(t);}, ${everyMs});`,
  ];
}

describe('supervisor', () => {
  let home: string;
  let db: IndexDb;
  let supervisors: Supervisor[];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-sup-'));
    db = openIndexDb(home);
    supervisors = [];
    createWorkspace(home, { id: WS, name: 'WS One' });
    createAgent(home, db, {
      id: AGENT,
      workspaceId: WS,
      name: 'Ada',
      harness: { provider: 'claude-code' },
      credentialProfileId: 'byok',
    } as AgentConfig);
  });

  afterEach(async () => {
    for (const s of supervisors) s.close();
    db.close();
    // give detached runners a beat to exit via their stop path before cleanup
    await sleep(50);
    fs.rmSync(home, { recursive: true, force: true });
  });

  function makeSupervisor(bus: EventBus): Supervisor {
    const supervisor = createSupervisor({
      home,
      db,
      bus,
      runnerMainPath: RUNNER_MAIN,
      heartbeatMs: 50,
      connectTimeoutMs: 5000,
      exitGraceMs: 500,
    });
    supervisors.push(supervisor);
    return supervisor;
  }

  it('re-adopts a running session after daemon death with zero event loss (accept, flagship)', async () => {
    // ── daemon #1 starts a session
    const busA = createEventBus();
    const supervisorA = makeSupervisor(busA);
    const record = await supervisorA.startSession({
      workspaceId: WS,
      agentId: AGENT,
      childArgv: countingChild(40, 50),
    });
    const sessionId = record.id;
    expect(record.state).toBe('running');
    expect(record.runnerPid).toBeTypeOf('number');
    expect(record.runnerSocket).toBeTruthy();
    expect(supervisorA.hasLiveRunner(sessionId)).toBe(true);

    const seenByA: AeosEvent[] = [];
    busA.subscribe({ sessionId }, (e) => seenByA.push(e));
    await waitFor(() => seenByA.filter((e) => e.type === 'item.message').length >= 5);

    // ── daemon #1 "SIGKILLs": drop the supervisor object + its socket clients.
    // The runner is a separate detached OS process and keeps going.
    supervisorA.close();
    expect(supervisorA.hasLiveRunner(sessionId)).toBe(false);

    // ── daemon #2 boots over the same AEOS_HOME and adopts
    const busB = createEventBus();
    const supervisorB = makeSupervisor(busB);
    const seenByB: AeosEvent[] = [];
    busB.subscribe({ sessionId }, (e) => seenByB.push(e));

    const report = await supervisorB.adoptOrphans();
    expect(report.adopted).toEqual([sessionId]);
    expect(report.orphaned).toEqual([]);
    expect(supervisorB.hasLiveRunner(sessionId)).toBe(true);

    // child finishes under daemon #2
    await waitFor(() => seenByB.some((e) => e.type === 'session.completed'));

    // the runner-owned transcript has every line exactly once, in order
    const transcript = fs
      .readFileSync(transcriptPath(home, WS, AGENT, sessionId), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AeosEvent);
    const lines = transcript
      .filter((e) => e.type === 'item.message')
      .map((e) => (e.payload as { text: string }).text)
      .filter((t) => t.startsWith('line-'));
    expect(lines).toEqual(Array.from({ length: 40 }, (_, i) => `line-${i + 1}`));

    // replay covered the daemon-death gap: daemon #2 saw every line too
    const linesSeenByB = seenByB
      .filter((e) => e.type === 'item.message')
      .map((e) => (e.payload as { text: string }).text)
      .filter((t) => t.startsWith('line-'));
    expect(linesSeenByB).toEqual(lines);

    supervisorB.stopSession(sessionId, 'test done');
  });

  it('marks unreachable running sessions orphaned and emits session.orphaned', async () => {
    const bus = createEventBus();
    const supervisor = makeSupervisor(bus);
    const events: AeosEvent[] = [];
    bus.subscribe({ typePrefix: 'session.' }, (e) => events.push(e));

    // a session.yaml claiming to run on a socket that no longer exists
    const record = await supervisorLessSession('01ARZ3NDEKTSV4RRFFQ69G5FB1');
    const report = await supervisor.adoptOrphans();

    expect(report.adopted).toEqual([]);
    expect(report.orphaned).toEqual([record.id]);
    expect(readSessionYaml(home, WS, AGENT, record.id).state).toBe('orphaned');
    expect(events.some((e) => e.type === 'session.orphaned' && e.sessionId === record.id)).toBe(true);
    expect(events.some((e) => e.type === 'session.state_changed' && e.sessionId === record.id)).toBe(
      true,
    );
  });

  it('startSession persists lifecycle states into session.yaml (created→starting→running)', async () => {
    const bus = createEventBus();
    const supervisor = makeSupervisor(bus);
    const states: string[] = [];
    bus.subscribe({ typePrefix: 'session.state_changed' }, (e) => {
      states.push((e.payload as { to: string }).to);
    });
    const record = await supervisor.startSession({
      workspaceId: WS,
      agentId: AGENT,
      childArgv: countingChild(2, 20),
    });
    expect(states).toEqual(['starting', 'running']);
    expect(readSessionYaml(home, WS, AGENT, record.id).state).toBe('running');
    supervisor.stopSession(record.id, 'test done');
  });

  /** Writes a fake session.yaml directly (no supervisor) for orphan tests. */
  async function supervisorLessSession(id: string) {
    const { writeSessionYaml, indexSession } = await import('@aeos/kernel');
    const record = {
      id,
      agentId: AGENT,
      state: 'running' as const,
      runnerPid: 999_999,
      runnerSocket: path.join(home, 'nonexistent.sock'),
    };
    fs.mkdirSync(path.dirname(transcriptPath(home, WS, AGENT, id)), { recursive: true });
    writeSessionYaml(home, WS, AGENT, id, record);
    indexSession(db, record, Date.now());
    return record;
  }
});
