import fs from 'node:fs';
import path from 'node:path';
import { AgentConfigSchema, type AgentConfig, type Workspace, WorkspaceSchema } from '@aeos/contracts';
import { writeFileAtomic } from '../home/atomic.js';
import {
  readAgentYaml,
  readWorkspaceYaml,
  writeAgentYaml,
  writeWorkspaceYaml,
} from '../home/codecs.js';
import { listSubdirs } from '../home/dirs.js';
import { agentDir, agentYaml, ensureAgentLayout, workspaceDir, workspaceYaml } from '../home/paths.js';
import { indexAgent } from '../index-db/reindex.js';
import type { IndexDb } from '../index-db/db.js';
import { commitAll, initRepo } from './git.js';

/** Thrown on registry invariant violations (missing/duplicate entities). */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** Ephemeral / machine-specific dirs stay out of the agent's git history. */
const AGENT_GITIGNORE = 'sessions/\nworktrees/\nharness/\n';

function mtime(filePath: string): number {
  return Math.floor(fs.statSync(filePath).mtimeMs);
}

// ── workspaces (files are truth; not indexed — dir walk is cheap at this level)

export function createWorkspace(home: string, workspace: Workspace): Workspace {
  const validated = WorkspaceSchema.parse(workspace);
  if (fs.existsSync(workspaceYaml(home, validated.id))) {
    throw new RegistryError(`workspace '${validated.id}' already exists`);
  }
  fs.mkdirSync(workspaceDir(home, validated.id), { recursive: true });
  writeWorkspaceYaml(home, validated.id, validated);
  return validated;
}

export function getWorkspace(home: string, workspaceId: string): Workspace {
  if (!fs.existsSync(workspaceYaml(home, workspaceId))) {
    throw new RegistryError(`workspace '${workspaceId}' does not exist`);
  }
  return readWorkspaceYaml(home, workspaceId);
}

export function listWorkspaces(home: string): Workspace[] {
  return listSubdirs(path.join(home, 'workspaces'))
    .filter((id) => fs.existsSync(workspaceYaml(home, id)))
    .map((id) => readWorkspaceYaml(home, id));
}

// ── agents (files are truth; index updated in the same call)

export function createAgent(home: string, db: IndexDb, config: AgentConfig): AgentConfig {
  const validated = AgentConfigSchema.parse(config);
  getWorkspace(home, validated.workspaceId); // throws RegistryError if missing
  if (fs.existsSync(agentYaml(home, validated.workspaceId, validated.id))) {
    throw new RegistryError(
      `agent '${validated.id}' already exists in workspace '${validated.workspaceId}'`,
    );
  }
  ensureAgentLayout(home, validated.workspaceId, validated.id);
  const dir = agentDir(home, validated.workspaceId, validated.id);
  writeFileAtomic(path.join(dir, '.gitignore'), AGENT_GITIGNORE);
  writeAgentYaml(home, validated.workspaceId, validated.id, validated);
  initRepo(dir);
  commitAll(dir, 'chore: agent created');
  indexAgent(db, validated, mtime(agentYaml(home, validated.workspaceId, validated.id)));
  return validated;
}

export function getAgent(home: string, workspaceId: string, agentId: string): AgentConfig {
  if (!fs.existsSync(agentYaml(home, workspaceId, agentId))) {
    throw new RegistryError(`agent '${agentId}' does not exist in workspace '${workspaceId}'`);
  }
  return readAgentYaml(home, workspaceId, agentId);
}

export function listAgents(home: string, workspaceId: string): AgentConfig[] {
  return listSubdirs(path.join(workspaceDir(home, workspaceId), 'agents'))
    .filter((id) => fs.existsSync(agentYaml(home, workspaceId, id)))
    .map((id) => readAgentYaml(home, workspaceId, id));
}

/** Immutable update: returns the new persisted config; never mutates inputs. */
export function updateAgent(
  home: string,
  db: IndexDb,
  workspaceId: string,
  agentId: string,
  patch: Partial<AgentConfig>,
): AgentConfig {
  const current = getAgent(home, workspaceId, agentId);
  const validated = AgentConfigSchema.parse({ ...current, ...patch });
  if (validated.id !== agentId || validated.workspaceId !== workspaceId) {
    throw new RegistryError('agent id / workspaceId are immutable');
  }
  writeAgentYaml(home, workspaceId, agentId, validated);
  const changed = Object.keys(patch).sort().join(', ');
  commitAll(agentDir(home, workspaceId, agentId), `chore: update ${changed}`);
  indexAgent(db, validated, mtime(agentYaml(home, workspaceId, agentId)));
  return validated;
}
