import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPolicyStack } from '../src/index.js';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-policy-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function writeWsPolicy(ws: string, yamlBody: string): void {
  fs.mkdirSync(path.join(home, 'workspaces', ws), { recursive: true });
  fs.writeFileSync(path.join(home, 'workspaces', ws, 'policy.yaml'), yamlBody);
}

describe('loadPolicyStack', () => {
  it('returns the default posture when no policy files exist', async () => {
    const policy = await loadPolicyStack({ home, workspaceId: 'ws1', agentId: 'ada' });
    expect(policy.tiers.git_push).toBe('confirm');
  });

  it('layers workspace then agent, most-specific wins', async () => {
    writeWsPolicy('ws1', 'tiers:\n  git_push: deny\n');
    const agentDir = path.join(home, 'workspaces', 'ws1', 'agents', 'ada');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'policy.yaml'), 'tiers:\n  git_push: allow\n');

    const merged = await loadPolicyStack({ home, workspaceId: 'ws1', agentId: 'ada' });
    expect(merged.tiers.git_push).toBe('allow');
    // a different agent without its own file still inherits the workspace layer
    const other = await loadPolicyStack({ home, workspaceId: 'ws1', agentId: 'grace' });
    expect(other.tiers.git_push).toBe('deny');
  });

  it('rejects malformed policy YAML loudly (a typo must never silently widen access)', async () => {
    writeWsPolicy('ws2', 'tiers: [broken\n');
    await expect(loadPolicyStack({ home, workspaceId: 'ws2', agentId: 'ada' })).rejects.toThrow();
  });
});
