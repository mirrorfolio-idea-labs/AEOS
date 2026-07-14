import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentConfig } from '@aeos/contracts';
import {
  agentDir,
  createAgent,
  createWorkspace,
  getAgent,
  getWorkspace,
  indexDbPath,
  listAgents,
  listWorkspaces,
  openIndexDb,
  queryAgents,
  RegistryError,
  reindex,
  updateAgent,
  type IndexDb,
} from '../src/index.js';

const ADA: AgentConfig = {
  id: 'ada',
  workspaceId: 'mirrorfolio',
  name: 'Ada',
  harness: { provider: 'claude-code' },
  credentialProfileId: 'byok',
} as AgentConfig;

function gitLog(dir: string): string[] {
  return execFileSync('git', ['log', '--format=%s'], { cwd: dir, encoding: 'utf8' })
    .trim()
    .split('\n');
}

let home: string;
let db: IndexDb;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-registry-'));
  db = openIndexDb(home);
  createWorkspace(home, { id: 'mirrorfolio', name: 'Mirrorfolio' });
});

afterEach(() => {
  db.close();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('workspace CRUD', () => {
  it('create/get/list round-trip', () => {
    expect(getWorkspace(home, 'mirrorfolio')).toEqual({ id: 'mirrorfolio', name: 'Mirrorfolio' });
    createWorkspace(home, { id: 'research', name: 'Research' });
    expect(listWorkspaces(home).map((w) => w.id)).toEqual(['mirrorfolio', 'research']);
  });

  it('duplicate create throws RegistryError', () => {
    expect(() => createWorkspace(home, { id: 'mirrorfolio', name: 'Again' })).toThrow(RegistryError);
  });
});

describe('agent CRUD', () => {
  it('create round-trips through file, getAgent, and index', () => {
    const created = createAgent(home, db, ADA);
    // returned object is the persisted shape: schema defaults (hermetic toggles) applied
    expect(created.id).toBe('ada');
    expect(created.harness.featureToggles).toBeDefined();
    expect(getAgent(home, 'mirrorfolio', 'ada').name).toBe('Ada');
    expect(listAgents(home, 'mirrorfolio').map((a) => a.id)).toEqual(['ada']);
    expect(queryAgents(db).map((a) => [a.workspaceId, a.id])).toEqual([['mirrorfolio', 'ada']]);
    // layout skeleton exists
    for (const d of ['memory', 'objectives', 'harness', 'worktrees']) {
      expect(fs.existsSync(path.join(agentDir(home, 'mirrorfolio', 'ada'), d))).toBe(true);
    }
  });

  it('agent dir is a git repo with one commit per mutation (portability story)', () => {
    createAgent(home, db, ADA);
    const dir = agentDir(home, 'mirrorfolio', 'ada');
    expect(gitLog(dir)).toEqual(['chore: agent created']);

    updateAgent(home, db, 'mirrorfolio', 'ada', { name: 'Ada Lovelace' });
    const log = gitLog(dir);
    expect(log).toHaveLength(2);
    expect(log[0]).toContain('name'); // message names the changed keys
  });

  it('updateAgent is immutable and syncs the index', () => {
    createAgent(home, db, ADA);
    const before = getAgent(home, 'mirrorfolio', 'ada');
    const after = updateAgent(home, db, 'mirrorfolio', 'ada', { name: 'Ada Lovelace' });
    expect(before.name).toBe('Ada'); // input object untouched
    expect(after.name).toBe('Ada Lovelace');
    expect(after).not.toBe(before);
    expect(queryAgents(db)[0]!.name).toBe('Ada Lovelace');
  });

  it('guards: unknown workspace and duplicate agent throw', () => {
    expect(() => createAgent(home, db, { ...ADA, workspaceId: 'ghost' })).toThrow(RegistryError);
    createAgent(home, db, ADA);
    expect(() => createAgent(home, db, ADA)).toThrow(RegistryError);
  });

  it('delete index.db → reindex → identical agent listing (files are truth)', () => {
    createAgent(home, db, ADA);
    updateAgent(home, db, 'mirrorfolio', 'ada', { name: 'Ada Lovelace' });
    const fromIndex = queryAgents(db);
    db.close();
    fs.rmSync(indexDbPath(home));
    db = openIndexDb(home);
    reindex(home, db);
    expect(queryAgents(db)).toEqual(fromIndex);
    expect(listAgents(home, 'mirrorfolio')[0]!.name).toBe('Ada Lovelace');
  });
});
