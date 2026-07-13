import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentDir,
  agentYaml,
  auditDir,
  costsPath,
  ensureAgentLayout,
  indexDbPath,
  sessionDir,
  sessionYaml,
  transcriptPath,
} from '../src/home/paths.js';

function readdirRecursive(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = entry.name;
    if (entry.isDirectory()) {
      out.push(rel + '/');
      for (const child of readdirRecursive(path.join(root, entry.name))) {
        out.push(path.join(rel, child));
      }
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

describe('paths', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-paths-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('builds absolute paths via path.join from an explicit home arg', () => {
    expect(agentDir(home, 'ws1', 'agent1')).toBe(
      path.join(home, 'workspaces', 'ws1', 'agents', 'agent1'),
    );
    expect(agentYaml(home, 'ws1', 'agent1')).toBe(
      path.join(home, 'workspaces', 'ws1', 'agents', 'agent1', 'agent.yaml'),
    );
    expect(sessionDir(home, 'ws1', 'agent1', 'sess1')).toBe(
      path.join(home, 'workspaces', 'ws1', 'agents', 'agent1', 'sessions', 'sess1'),
    );
    expect(sessionYaml(home, 'ws1', 'agent1', 'sess1')).toBe(
      path.join(
        home,
        'workspaces',
        'ws1',
        'agents',
        'agent1',
        'sessions',
        'sess1',
        'session.yaml',
      ),
    );
    expect(transcriptPath(home, 'ws1', 'agent1', 'sess1')).toBe(
      path.join(
        home,
        'workspaces',
        'ws1',
        'agents',
        'agent1',
        'sessions',
        'sess1',
        'transcript.ndjson',
      ),
    );
    expect(costsPath(home, 'ws1', 'agent1', 'sess1')).toBe(
      path.join(home, 'workspaces', 'ws1', 'agents', 'agent1', 'sessions', 'sess1', 'costs.ndjson'),
    );
    expect(indexDbPath(home)).toBe(path.join(home, 'index.db'));
    expect(auditDir(home)).toBe(path.join(home, 'audit'));
  });

  it('never returns a relative path, regardless of cwd', () => {
    expect(path.isAbsolute(agentDir(home, 'ws1', 'agent1'))).toBe(true);
    expect(path.isAbsolute(sessionYaml(home, 'ws1', 'agent1', 'sess1'))).toBe(true);
  });

  it('ensureAgentLayout creates exactly the empty-dir skeleton (spec §7 tree)', () => {
    ensureAgentLayout(home, 'ws1', 'agent1');

    const tree = readdirRecursive(home);
    expect(tree).toEqual(
      [
        'audit/',
        'workspaces/',
        'workspaces/ws1/',
        'workspaces/ws1/agents/',
        'workspaces/ws1/agents/agent1/',
        'workspaces/ws1/agents/agent1/harness/',
        'workspaces/ws1/agents/agent1/memory/',
        'workspaces/ws1/agents/agent1/objectives/',
        'workspaces/ws1/agents/agent1/worktrees/',
      ].sort(),
    );
  });

  it('ensureAgentLayout is idempotent', () => {
    ensureAgentLayout(home, 'ws1', 'agent1');
    expect(() => ensureAgentLayout(home, 'ws1', 'agent1')).not.toThrow();
  });
});
