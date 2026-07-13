import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig, SessionRecord } from '@aeos/contracts';
import { CodecError, readAgentYaml, readSessionYaml } from '../home/codecs.js';
import { agentDir, agentYaml, sessionYaml } from '../home/paths.js';
import type { IndexDb } from './db.js';

export interface AgentRow {
  workspaceId: string;
  id: string;
  name: string;
  updatedAt: number;
}

export interface SessionRow {
  id: string;
  agentId: string;
  state: string;
  providerSessionId: string | null;
  updatedAt: number;
}

export interface CorruptEntry {
  path: string;
  message: string;
}

export interface ReindexReport {
  agents: number;
  sessions: number;
  corrupt: CorruptEntry[];
}

export function indexAgent(db: IndexDb, agent: AgentConfig, updatedAt: number): void {
  db.prepare(
    `INSERT INTO agents (workspace_id, id, name, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (workspace_id, id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
  ).run(agent.workspaceId, agent.id, agent.name, updatedAt);
}

export function indexSession(db: IndexDb, session: SessionRecord, updatedAt: number): void {
  db.prepare(
    `INSERT INTO sessions (id, agent_id, state, provider_session_id, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       agent_id = excluded.agent_id, state = excluded.state,
       provider_session_id = excluded.provider_session_id, updated_at = excluded.updated_at`,
  ).run(session.id, session.agentId, session.state, session.providerSessionId ?? null, updatedAt);
}

export function queryAgents(db: IndexDb): AgentRow[] {
  return db
    .prepare(
      `SELECT workspace_id AS workspaceId, id, name, updated_at AS updatedAt
       FROM agents ORDER BY workspace_id, id`,
    )
    .all() as AgentRow[];
}

export function querySessions(db: IndexDb): SessionRow[] {
  return db
    .prepare(
      `SELECT id, agent_id AS agentId, state, provider_session_id AS providerSessionId,
              updated_at AS updatedAt
       FROM sessions ORDER BY id`,
    )
    .all() as SessionRow[];
}

function listSubdirs(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // missing tree level = nothing to index
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function mtime(filePath: string): number {
  return Math.floor(fs.statSync(filePath).mtimeMs);
}

/**
 * Full rebuild from files (spec §6: `aeos reindex`). Never throws on a single
 * bad file — corrupt entries are skipped and reported. Runs in one
 * transaction: readers never observe a half-rebuilt index.
 */
export function reindex(home: string, db: IndexDb): ReindexReport {
  const report: ReindexReport = { agents: 0, sessions: 0, corrupt: [] };
  const agents: Array<{ config: AgentConfig; updatedAt: number }> = [];
  const sessions: Array<{ record: SessionRecord; updatedAt: number }> = [];

  for (const ws of listSubdirs(path.join(home, 'workspaces'))) {
    for (const agentId of listSubdirs(path.join(home, 'workspaces', ws, 'agents'))) {
      try {
        agents.push({
          config: readAgentYaml(home, ws, agentId),
          updatedAt: mtime(agentYaml(home, ws, agentId)),
        });
      } catch (error) {
        report.corrupt.push(toCorrupt(error, agentYaml(home, ws, agentId)));
        continue; // unreadable agent: skip its sessions too (no trustworthy owner)
      }
      for (const sessionId of listSubdirs(path.join(agentDir(home, ws, agentId), 'sessions'))) {
        try {
          sessions.push({
            record: readSessionYaml(home, ws, agentId, sessionId),
            updatedAt: mtime(sessionYaml(home, ws, agentId, sessionId)),
          });
        } catch (error) {
          report.corrupt.push(toCorrupt(error, sessionYaml(home, ws, agentId, sessionId)));
        }
      }
    }
  }

  db.transaction(() => {
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM agents').run();
    for (const { config, updatedAt } of agents) indexAgent(db, config, updatedAt);
    for (const { record, updatedAt } of sessions) indexSession(db, record, updatedAt);
  })();

  report.agents = agents.length;
  report.sessions = sessions.length;
  return report;
}

function toCorrupt(error: unknown, fallbackPath: string): CorruptEntry {
  if (error instanceof CodecError) return { path: error.path, message: error.message };
  return { path: fallbackPath, message: error instanceof Error ? error.message : String(error) };
}
