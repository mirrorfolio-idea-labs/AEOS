import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AeosEventSchema, newEventId, type AgentConfig } from '@aeos/contracts';
import { aeosYamlPath, auditDir, createAgent, createWorkspace, indexSession, transcriptPath } from '@aeos/kernel';
import type { SessionRecord } from '@aeos/contracts';
import { createDaemon } from '../src/daemon.js';

const S1 = '01ARZ3NDEKTSV4RRFFQ69G5FA0';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeosd-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('aeosd daemon', () => {
  it('boots, self-checks healthy, and shuts down cleanly', async () => {
    const daemon = createDaemon({ home });
    await daemon.start();
    const health = await daemon.health();
    expect(health.ok).toBe(true);
    expect(Object.keys(health.modules)).toEqual(['home', 'index-db', 'event-bus', 'supervisor']);
    // first boot materializes config + audit dir
    expect(fs.existsSync(aeosYamlPath(home))).toBe(true);
    expect(fs.existsSync(auditDir(home))).toBe(true);
    await daemon.stop(); // clean shutdown: no open handles → vitest exits
  });

  it('wires registry, index, bus, and transcripts together', async () => {
    const daemon = createDaemon({ home });
    await daemon.start();

    createWorkspace(home, { id: 'ws1', name: 'WS One' });
    createAgent(daemon.deps.home, daemon.deps.db, {
      id: 'ada',
      workspaceId: 'ws1',
      name: 'Ada',
      harness: { provider: 'claude-code' },
      credentialProfileId: 'byok',
    } as AgentConfig);
    indexSession(daemon.deps.db, { id: S1, agentId: 'ada', state: 'running' } as SessionRecord, 0);

    daemon.deps.bus.publish(
      AeosEventSchema.parse({
        v: 1,
        id: newEventId(),
        ts: new Date('2026-07-14T00:00:00Z').toISOString(),
        source: 'aeosd-test',
        agentId: 'ada',
        sessionId: S1,
        type: 'session.created',
        payload: {},
      }),
    );

    const line = fs.readFileSync(transcriptPath(home, 'ws1', 'ada', S1), 'utf8').trim();
    expect(AeosEventSchema.parse(JSON.parse(line)).type).toBe('session.created');

    const report = daemon.reindex();
    expect(report.agents).toBe(1);
    await daemon.stop();
  });

  it('refuses to boot on an unusable home', async () => {
    const fileAsHome = path.join(home, 'not-a-dir');
    fs.writeFileSync(fileAsHome, 'occupied');
    const daemon = createDaemon({ home: fileAsHome });
    await expect(daemon.start()).rejects.toThrow();
  });
});
