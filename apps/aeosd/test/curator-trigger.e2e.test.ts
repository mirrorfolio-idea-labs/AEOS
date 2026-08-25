import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AeosEventSchema, newEventId, type AgentConfig } from '@aeos/contracts';
import { agentDir, createAgent, createWorkspace } from '@aeos/kernel';
import { initMemoryLayout } from '@aeos/memory';
import { createDaemon } from '../src/daemon.js';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'aeosd-curator-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;

async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(25);
  }
  return predicate();
}

function curatorLog(): string {
  return path.join(home, 'audit', `curator-${new Date().toISOString().slice(0, 10)}.ndjson`);
}

describe('curator idle trigger (P2.M4.T1)', () => {
  it('fires a dry-run for an idle agent and mutates nothing', async () => {
    const daemon = createDaemon({
      home,
      curator: { idleMs: 250, minIntervalMs: 60_000, tickMs: 50 },
    });
    await daemon.start();

    createWorkspace(home, { id: 'ws1', name: 'WS' });
    createAgent(daemon.deps.home, daemon.deps.db, {
      id: 'ada',
      workspaceId: 'ws1',
      name: 'Ada',
      harness: { provider: 'claude-code' },
      credentialProfileId: 'byok',
    } as AgentConfig);
    const memoryRoot = path.join(agentDir(home, 'ws1', 'ada'), 'memory');
    await initMemoryLayout(memoryRoot);
    const staleAbs = path.join(memoryRoot, 'research', 'old.md');
    fs.mkdirSync(path.dirname(staleAbs), { recursive: true });
    fs.writeFileSync(staleAbs, 'stale research\n');
    const staleTime = new Date(Date.now() - 40 * DAY);
    fs.utimesSync(staleAbs, staleTime, staleTime);

    daemon.deps.bus.publish(
      AeosEventSchema.parse({
        v: 1,
        id: newEventId(),
        ts: new Date().toISOString(),
        source: 'curator-test',
        agentId: 'ada',
        type: 'session.created',
        payload: {},
      }),
    );

    expect(await waitFor(() => fs.existsSync(curatorLog()), 4000)).toBe(true);
    const lines = fs.readFileSync(curatorLog(), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as {
      agentRef: string;
      dryRun: boolean;
      proposals: Array<{ path: string; reason: string }>;
    };
    expect(parsed.agentRef).toBe('ws1/ada');
    expect(parsed.dryRun).toBe(true);
    expect(parsed.proposals).toEqual([{ op: 'archive', path: 'research/old.md', reason: 'stale' }]);
    // dry-run changes nothing
    expect(fs.readFileSync(staleAbs, 'utf8')).toBe('stale research\n');
    await daemon.stop();
  });

  it('is absent entirely when not configured', async () => {
    const daemon = createDaemon({ home });
    await daemon.start();
    const health = await daemon.health();
    expect(Object.keys(health.modules)).toEqual([
      'home',
      'index-db',
      'event-bus',
      'supervisor',
    ]);
    await delay(150);
    expect(fs.existsSync(curatorLog())).toBe(false);
    await daemon.stop();
  });

  it('full loop — dry-run trigger, then an induced apply run is audited and lossless', async () => {
    const { runCurator } = await import('@aeos/memory');
    const { readdir: readDir } = await import('node:fs/promises');

    const daemon = createDaemon({
      home,
      curator: { idleMs: 250, minIntervalMs: 60_000, tickMs: 50 },
    });
    await daemon.start();

    createWorkspace(home, { id: 'ws1', name: 'WS' });
    createAgent(daemon.deps.home, daemon.deps.db, {
      id: 'ada',
      workspaceId: 'ws1',
      name: 'Ada',
      harness: { provider: 'claude-code' },
      credentialProfileId: 'byok',
    } as AgentConfig);
    const memoryRoot = path.join(agentDir(home, 'ws1', 'ada'), 'memory');
    await initMemoryLayout(memoryRoot);
    const staleAbs = path.join(memoryRoot, 'research', 'old.md');
    fs.mkdirSync(path.dirname(staleAbs), { recursive: true });
    fs.writeFileSync(staleAbs, 'stale research\n');
    const staleTime = new Date(Date.now() - 40 * DAY);
    fs.utimesSync(staleAbs, staleTime, staleTime);

    daemon.deps.bus.publish(
      AeosEventSchema.parse({
        v: 1,
        id: newEventId(),
        ts: new Date().toISOString(),
        source: 'curator-test',
        agentId: 'ada',
        type: 'session.created',
        payload: {},
      }),
    );

    // Phase 1 — the daemon's own idle trigger fires a dry-run
    expect(await waitFor(() => fs.existsSync(curatorLog()), 4000)).toBe(true);

    // Phase 2 — induced apply-mode run (the daemon stays dry-run in v0.2),
    // with the daemon-side memory.written emission wired like production
    const applied: Array<{ path: string; bytes: number }> = [];
    const applyReport = await runCurator(memoryRoot, {
      dryRun: false,
      now: new Date(),
      auditHome: home,
      agentRef: 'ws1/ada',
      onApplied: (event) => {
        applied.push({ path: event.path, bytes: event.bytes });
        daemon.deps.bus.publish(
          AeosEventSchema.parse({
            v: 1,
            id: newEventId(),
            ts: new Date().toISOString(),
            source: 'curator',
            agentId: 'ada',
            type: 'memory.written',
            payload: { path: event.path, bytes: event.bytes },
          }),
        );
      },
    });
    expect(applyReport.results?.map((r) => r.status)).toEqual(['applied']);
    expect(applied).toEqual([{ path: 'research/old.md', bytes: 0 }]);

    // reorganized, never deleted
    expect(fs.existsSync(staleAbs)).toBe(false);
    const archiveDir = path.join(memoryRoot, '.archive', 'research');
    expect((await readDir(archiveDir))).toContain('old.md');

    // main audit carries the memory.written row (curator is its first live emitter)
    const auditFiles = await readDir(path.join(home, 'audit'));
    const mainAudit = auditFiles.find((f) => f.startsWith('audit-'));
    expect(mainAudit).toBeDefined();
    const auditText = fs.readFileSync(path.join(home, 'audit', mainAudit as string), 'utf8');
    expect(auditText).toContain('"type":"memory.written"');
    expect(auditText).toContain('research/old.md');

    // curator trail now holds both runs; the apply line reports results
    const trailLines = fs.readFileSync(curatorLog(), 'utf8').trimEnd().split('\n');
    expect(trailLines.length).toBeGreaterThanOrEqual(2);
    const lastLine = JSON.parse(trailLines[trailLines.length - 1] as string) as {
      dryRun: boolean;
      results?: Array<{ status: string }>;
    };
    expect(lastLine.dryRun).toBe(false);
    expect(lastLine.results?.[0]?.status).toBe('applied');

    // lossless: the original byte survives under .archive
    expect(
      fs.readFileSync(path.join(archiveDir, 'old.md'), 'utf8'),
    ).toBe('stale research\n');

    await daemon.stop();
  });
});
