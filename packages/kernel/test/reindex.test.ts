import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentConfig, SessionRecord } from '@aeos/contracts';
import {
  ensureAgentLayout,
  indexAgent,
  indexDbPath,
  indexSession,
  openIndexDb,
  queryAgents,
  querySessions,
  reindex,
  SCHEMA_VERSION,
  sessionDir,
  sessionYaml,
  writeAgentYaml,
  writeSessionYaml,
  type IndexDb,
} from '../src/index.js';

// Valid Crockford-base32 ULIDs (no I/L/O/U), varied in the last character.
const ULIDS = [
  '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  '01ARZ3NDEKTSV4RRFFQ69G5FA1',
  '01ARZ3NDEKTSV4RRFFQ69G5FA2',
  '01ARZ3NDEKTSV4RRFFQ69G5FA3',
] as const;

function agent(ws: string, id: string, name: string): AgentConfig {
  return {
    id,
    workspaceId: ws,
    name,
    harness: { provider: 'claude-code' },
    credentialProfileId: 'byok',
  } as AgentConfig;
}

function session(id: string, agentId: string, state: SessionRecord['state']): SessionRecord {
  return { id, agentId, state, providerSessionId: `prov-${id.slice(-2)}` } as SessionRecord;
}

/** 2 workspaces, 3 agents, 4 sessions — written through the T1 public API. */
function seed(home: string): void {
  const agents: Array<[string, string, string]> = [
    ['ws1', 'a1', 'Ada'],
    ['ws1', 'a2', 'Blaise'],
    ['ws2', 'a3', 'Curie'],
  ];
  for (const [ws, id, name] of agents) {
    ensureAgentLayout(home, ws, id);
    writeAgentYaml(home, ws, id, agent(ws, id, name));
  }
  const sessions: Array<[string, string, string]> = [
    ['ws1', 'a1', ULIDS[0]],
    ['ws1', 'a1', ULIDS[1]],
    ['ws1', 'a2', ULIDS[2]],
    ['ws2', 'a3', ULIDS[3]],
  ];
  for (const [ws, agentId, sid] of sessions) {
    fs.mkdirSync(sessionDir(home, ws, agentId, sid), { recursive: true });
    writeSessionYaml(home, ws, agentId, sid, session(sid, agentId, 'running'));
  }
}

function snapshot(db: IndexDb): { agents: unknown[]; sessions: unknown[] } {
  return { agents: queryAgents(db), sessions: querySessions(db) };
}

let home: string;
let db: IndexDb;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-reindex-'));
  seed(home);
  db = openIndexDb(home);
});

afterEach(() => {
  db.close();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('reindex', () => {
  it('full rebuild indexes every agent and session from files', () => {
    const report = reindex(home, db);
    expect(report.agents).toBe(3);
    expect(report.sessions).toBe(4);
    expect(report.corrupt).toEqual([]);

    const agents = queryAgents(db);
    expect(agents.map((a) => [a.workspaceId, a.id, a.name])).toEqual([
      ['ws1', 'a1', 'Ada'],
      ['ws1', 'a2', 'Blaise'],
      ['ws2', 'a3', 'Curie'],
    ]);
    const sessions = querySessions(db);
    expect(sessions.map((s) => [s.id, s.agentId, s.state, s.providerSessionId])).toEqual([
      [ULIDS[0], 'a1', 'running', 'prov-A0'],
      [ULIDS[1], 'a1', 'running', 'prov-A1'],
      [ULIDS[2], 'a2', 'running', 'prov-A2'],
      [ULIDS[3], 'a3', 'running', 'prov-A3'],
    ]);
  });

  it('delete index.db → reindex() → identical query results (exit gate)', () => {
    reindex(home, db);
    const before = snapshot(db);
    db.close();
    fs.rmSync(indexDbPath(home));
    db = openIndexDb(home);
    reindex(home, db);
    expect(snapshot(db)).toEqual(before);
  });

  it('reports corrupt files and indexes the rest', () => {
    fs.writeFileSync(sessionYaml(home, 'ws1', 'a1', ULIDS[0]), 'state: [unclosed');
    const report = reindex(home, db);
    expect(report.agents).toBe(3);
    expect(report.sessions).toBe(3);
    expect(report.corrupt).toHaveLength(1);
    expect(report.corrupt[0]!.path).toContain(ULIDS[0]);
    expect(querySessions(db).map((s) => s.id)).toEqual([ULIDS[1], ULIDS[2], ULIDS[3]]);
  });

  it('incremental upserts match a full rebuild', () => {
    reindex(home, db);
    const full = snapshot(db);

    db.close();
    fs.rmSync(indexDbPath(home));
    db = openIndexDb(home);
    for (const [ws, id, name] of [
      ['ws1', 'a1', 'Ada'],
      ['ws1', 'a2', 'Blaise'],
      ['ws2', 'a3', 'Curie'],
    ] as const) {
      const cfg = agent(ws, id, name);
      const mtime = Math.floor(fs.statSync(path.join(home, 'workspaces', ws, 'agents', id, 'agent.yaml')).mtimeMs);
      indexAgent(db, cfg, mtime);
    }
    for (const [ws, agentId, sid] of [
      ['ws1', 'a1', ULIDS[0]],
      ['ws1', 'a1', ULIDS[1]],
      ['ws1', 'a2', ULIDS[2]],
      ['ws2', 'a3', ULIDS[3]],
    ] as const) {
      const mtime = Math.floor(fs.statSync(sessionYaml(home, ws, agentId, sid)).mtimeMs);
      indexSession(db, session(sid, agentId, 'running'), mtime);
    }
    // upsert again — must not duplicate
    indexAgent(db, agent('ws1', 'a1', 'Ada'), 0);
    expect(querySessions(db)).toEqual(full.sessions);
    expect(queryAgents(db).map((a) => a.id)).toEqual((full.agents as Array<{ id: string }>).map((a) => a.id));
  });

  it('schema version mismatch drops and rebuilds (derived data is disposable)', () => {
    reindex(home, db);
    db.close();
    // simulate an old/foreign schema version
    const raw = new Database(indexDbPath(home));
    raw.pragma('user_version = 999');
    raw.close();
    db = openIndexDb(home);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(queryAgents(db)).toEqual([]); // dropped — caller reindexes
  });
});
