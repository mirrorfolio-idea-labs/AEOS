import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newEventId, type AgentConfig, type SessionRecord } from '@aeos/contracts';
import {
  attachTranscriptWriter,
  createEventBus,
  ensureAgentLayout,
  indexDbPath,
  openIndexDb,
  queryAgents,
  querySessions,
  reindex,
  sessionDir,
  transcriptPath,
  writeAgentYaml,
  writeSessionYaml,
  type IndexDb,
} from '../src/index.js';

/**
 * Scale + perf-baseline coverage (V3 overnight gauntlet). Correctness is
 * asserted at ~1k-entity / multi-thousand-event scale on every CI run;
 * latencies are printed as human-readable baselines only — never asserted,
 * so the green bar cannot go flaky on a slow runner.
 */

function perf(label: string, ms: number): void {
  console.info(`[perf] ${label}: ${ms.toFixed(1)}ms`);
}

function agent(ws: string, id: string): AgentConfig {
  return {
    id,
    workspaceId: ws,
    name: `Agent ${id}`,
    harness: { provider: 'claude-code' },
    credentialProfileId: 'byok',
  } as AgentConfig;
}

function session(id: string, agentId: string): SessionRecord {
  return {
    id,
    agentId,
    state: 'completed',
    providerSessionId: `prov-${id.slice(-4)}`,
  } as SessionRecord;
}

/** 4 workspaces x 8 agents x 30 sessions = 960 sessions (~1k YAML writes). */
describe('kernel at scale (V3 baselines)', () => {
  let home: string;
  let db: IndexDb;

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-scale-kernel-'));
    const t0 = performance.now();
    const agents: Array<{ ws: string; id: string }> = [];
    for (let w = 0; w < 4; w++) {
      for (let a = 0; a < 8; a++) {
        const ws = `ws${w}`;
        const id = `agent-${w}-${a}`;
        ensureAgentLayout(home, ws, id);
        writeAgentYaml(home, ws, id, agent(ws, id));
        agents.push({ ws, id });
      }
    }
    for (const { ws, id } of agents) {
      for (let s = 0; s < 30; s++) {
        const sid = newEventId();
        fs.mkdirSync(sessionDir(home, ws, id, sid), { recursive: true });
        writeSessionYaml(home, ws, id, sid, session(sid, id));
      }
    }
    db = openIndexDb(home);
    perf('build 960-session AEOS_HOME fixture', performance.now() - t0);
  }, 120_000);

  afterAll(() => {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('warm reindex at 960 sessions is complete and correct', () => {
    const t0 = performance.now();
    const report = reindex(home, db);
    perf('warm reindex (960 sessions)', performance.now() - t0);
    expect(report.corrupt).toEqual([]);
    expect(report.agents).toBe(32);
    expect(report.sessions).toBe(960);
    expect(queryAgents(db)).toHaveLength(32);
    expect(querySessions(db)).toHaveLength(960);
  });

  it('cold reindex (delete index.db -> rebuild) matches warm query results', () => {
    const warmAgents = queryAgents(db);
    const warmSessions = querySessions(db);

    const t0 = performance.now();
    db.close();
    fs.rmSync(indexDbPath(home));
    db = openIndexDb(home);
    const report = reindex(home, db);
    perf('cold reindex incl. reopen (960 sessions)', performance.now() - t0);

    expect(report.corrupt).toEqual([]);
    expect(queryAgents(db)).toEqual(warmAgents);
    expect(querySessions(db)).toEqual(warmSessions);
  });

  it('transcript appender keeps bus order over 2,500 events', () => {
    // route through the derived index exactly like the daemon does
    const report = reindex(home, db);
    expect(report.sessions).toBe(960);
    const ws = 'ws0';
    const agentId = 'agent-0-0';
    const sessionId = querySessions(db).find((r) => r.agentId === agentId)!.id;

    const bus = createEventBus();
    const unsubscribe = attachTranscriptWriter(bus, home, db);
    try {
      const count = 2_500;
      const t0 = performance.now();
      for (let i = 0; i < count; i++) {
        bus.publish({
          v: 1,
          id: newEventId(),
          ts: '2026-08-25T00:00:00.000Z',
          source: 'scale-test',
          agentId,
          sessionId,
          type: 'item.message',
          payload: { role: 'assistant', text: `line ${i}` },
        });
      }
      perf(`transcript append ${count} events via bus`, performance.now() - t0);

      const lines = fs.readFileSync(transcriptPath(home, ws, agentId, sessionId), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(count);
      const first = JSON.parse(lines[0]!) as { payload: { text: string } };
      const last = JSON.parse(lines[count - 1]!) as { payload: { text: string } };
      expect(first.payload.text).toBe('line 0');
      expect(last.payload.text).toBe(`line ${count - 1}`);
    } finally {
      unsubscribe();
    }
  });
});
