import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobSchema, createWakeupScheduler, isJobDue, listJobs, saveJob, type Job } from '../src/index.js';

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-jobs-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const cronJob = (over: Partial<Job> = {}): Job =>
  JobSchema.parse({
    id: 'nightly',
    kind: 'cron',
    cron: '0 2 * * *',
    action: { type: 'start-objective', workspaceId: 'ws', agentId: 'dev', objectiveId: 'o' },
    createdAt: '2026-09-25T00:00:00.000Z',
    ...over,
  });

describe('wakeup jobs (P3.M5.T1)', () => {
  it('validates cron expressions and idle requirements', () => {
    expect(() => cronJob({ cron: 'not a cron' })).toThrow(/invalid cron/);
    expect(() => JobSchema.parse({ ...cronJob(), kind: 'idle', cron: undefined })).toThrow(/idleMs/);
  });

  it('cron is due once its next slot after the last run passes', () => {
    const job = cronJob();
    expect(isJobDue(job, new Date('2026-09-25T01:59:00Z'), 0)).toBe(false);
    expect(isJobDue(job, new Date('2026-09-25T02:00:00Z'), 0)).toBe(true);
    expect(isJobDue({ ...job, lastRunAt: '2026-09-25T02:00:00.000Z' }, new Date('2026-09-25T12:00:00Z'), 0)).toBe(false);
    expect(isJobDue({ ...job, enabled: false }, new Date('2026-09-30T00:00:00Z'), 0)).toBe(false);
  });

  it('a job missed for days while the daemon was down fires exactly once on the next tick', async () => {
    saveJob(home, cronJob());
    const fired: string[] = [];
    const now = new Date('2026-09-29T09:00:00Z'); // four 02:00 slots missed
    const scheduler = createWakeupScheduler({ home, now: () => now, run: async (job) => void fired.push(job.id) });
    expect(await scheduler.tick()).toEqual(['nightly']);
    expect(await scheduler.tick()).toEqual([]);
    expect(fired).toEqual(['nightly']);
    expect(listJobs(home)[0]?.lastRunAt).toBe(now.toISOString());
  });

  it('lastRunAt is persisted BEFORE the action (a crash mid-action never re-fires in a loop); errors are recorded', async () => {
    saveJob(home, cronJob());
    const scheduler = createWakeupScheduler({
      home,
      now: () => new Date('2026-09-26T03:00:00Z'),
      run: async () => {
        expect(listJobs(home)[0]?.lastRunAt).toBe('2026-09-26T03:00:00.000Z');
        throw new Error('objective missing');
      },
    });
    await scheduler.tick();
    expect(listJobs(home)[0]).toMatchObject({ lastError: 'objective missing' });
  });

  it('idle jobs fire after enough idleness, respecting the min interval', async () => {
    saveJob(home, JobSchema.parse({ id: 'curate', kind: 'idle', idleMs: 60_000, minIntervalMs: 3_600_000, action: { type: 'curator' }, createdAt: '2026-09-26T00:00:00.000Z' }));
    let idle = 30_000;
    let now = new Date('2026-09-26T10:00:00Z');
    const fired: string[] = [];
    const scheduler = createWakeupScheduler({ home, now: () => now, idleForMs: () => idle, run: async (j) => void fired.push(j.id) });
    expect(await scheduler.tick()).toEqual([]);
    idle = 120_000;
    expect(await scheduler.tick()).toEqual(['curate']);
    now = new Date('2026-09-26T10:30:00Z');
    expect(await scheduler.tick()).toEqual([]); // min interval not yet passed
    now = new Date('2026-09-26T11:01:00Z');
    expect(await scheduler.tick()).toEqual(['curate']);
  });

  it('a hand-broken job file does not take the scheduler down', async () => {
    saveJob(home, cronJob());
    fs.writeFileSync(path.join(home, 'jobs', 'broken.yaml'), 'id: [unclosed');
    expect(listJobs(home).map((j) => j.id)).toEqual(['nightly']);
  });
});
