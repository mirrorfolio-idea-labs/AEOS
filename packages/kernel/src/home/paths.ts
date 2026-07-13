import fs from 'node:fs';
import path from 'node:path';

/**
 * `AEOS_HOME` on-disk layout (spec §7). Every function here takes `home` as
 * an explicit first argument and returns an absolute path built with
 * `path.join` — nothing in this module reads `process.env` or persists an
 * absolute path into a file. Tests must pass a `fs.mkdtemp` sandbox.
 */

export function workspaceDir(home: string, workspaceId: string): string {
  return path.join(home, 'workspaces', workspaceId);
}

export function agentDir(home: string, workspaceId: string, agentId: string): string {
  return path.join(workspaceDir(home, workspaceId), 'agents', agentId);
}

export function agentYaml(home: string, workspaceId: string, agentId: string): string {
  return path.join(agentDir(home, workspaceId, agentId), 'agent.yaml');
}

export function sessionDir(
  home: string,
  workspaceId: string,
  agentId: string,
  sessionId: string,
): string {
  return path.join(agentDir(home, workspaceId, agentId), 'sessions', sessionId);
}

export function sessionYaml(
  home: string,
  workspaceId: string,
  agentId: string,
  sessionId: string,
): string {
  return path.join(sessionDir(home, workspaceId, agentId, sessionId), 'session.yaml');
}

export function transcriptPath(
  home: string,
  workspaceId: string,
  agentId: string,
  sessionId: string,
): string {
  return path.join(sessionDir(home, workspaceId, agentId, sessionId), 'transcript.ndjson');
}

export function costsPath(
  home: string,
  workspaceId: string,
  agentId: string,
  sessionId: string,
): string {
  return path.join(sessionDir(home, workspaceId, agentId, sessionId), 'costs.ndjson');
}

export function indexDbPath(home: string): string {
  return path.join(home, 'index.db');
}

export function auditDir(home: string): string {
  return path.join(home, 'audit');
}

export function aeosYamlPath(home: string): string {
  return path.join(home, 'aeos.yaml');
}

/**
 * Creates the empty-dir skeleton for a freshly-registered agent: the agent's
 * own directory plus its `memory/objectives/harness/worktrees` subdirs, and
 * the home-level `audit/` directory. Idempotent — safe to call repeatedly.
 * Does NOT create `sessions/<id>` (that's created per-session once a session
 * ULID exists) or write `agent.yaml` (that's the codecs' job).
 */
export function ensureAgentLayout(home: string, workspaceId: string, agentId: string): void {
  const dir = agentDir(home, workspaceId, agentId);
  const dirs = [
    dir,
    path.join(dir, 'memory'),
    path.join(dir, 'objectives'),
    path.join(dir, 'harness'),
    path.join(dir, 'worktrees'),
    auditDir(home),
  ];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
}
