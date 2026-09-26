import fs from 'node:fs';
import path from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { writeFileAtomic } from '@aeos/kernel';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const JobActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start-objective'),
    workspaceId: z.string().regex(SLUG),
    agentId: z.string().regex(SLUG),
    objectiveId: z.string().min(1),
  }),
  /** Memory curator pass (spec §8.4) — the first idle-triggered job. */
  z.object({ type: z.literal('curator') }),
]);
export type JobAction = z.infer<typeof JobActionSchema>;

/**
 * `<home>/jobs/<id>.yaml` — a durable wakeup (spec §12). `cron` fires on a
 * schedule (UTC); `idle` fires once the daemon has been idle for `idleMs`,
 * at most every `minIntervalMs`. State (`lastRunAt`) lives in the same
 * file, so jobs survive daemon restarts by construction.
 */
export const JobSchema = z
  .object({
    id: z.string().regex(SLUG),
    kind: z.enum(['cron', 'idle']),
    cron: z.string().min(1).optional(),
    idleMs: z.number().int().positive().optional(),
    minIntervalMs: z.number().int().nonnegative().optional(),
    action: JobActionSchema,
    enabled: z.boolean().default(true),
    createdAt: z.string().datetime(),
    lastRunAt: z.string().datetime().optional(),
    lastError: z.string().optional(),
  })
  .superRefine((job, ctx) => {
    if (job.kind === 'cron') {
      if (job.cron === undefined) {
        ctx.addIssue({ code: 'custom', message: 'cron jobs need a `cron` expression', path: ['cron'] });
        return;
      }
      try {
        CronExpressionParser.parse(job.cron, { tz: 'UTC' });
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: `invalid cron: ${error instanceof Error ? error.message : String(error)}`, path: ['cron'] });
      }
    }
    if (job.kind === 'idle' && job.idleMs === undefined) {
      ctx.addIssue({ code: 'custom', message: 'idle jobs need `idleMs`', path: ['idleMs'] });
    }
  });
export type Job = z.infer<typeof JobSchema>;

export const jobsDir = (home: string): string => path.join(home, 'jobs');
const jobPath = (home: string, id: string): string => path.join(jobsDir(home), `${id}.yaml`);

export function saveJob(home: string, job: Job): Job {
  const valid = JobSchema.parse(job);
  fs.mkdirSync(jobsDir(home), { recursive: true });
  writeFileAtomic(jobPath(home, valid.id), stringifyYaml(valid));
  return valid;
}

export function listJobs(home: string): Job[] {
  let files: string[];
  try {
    files = fs.readdirSync(jobsDir(home)).filter((f) => f.endsWith('.yaml')).sort();
  } catch {
    return [];
  }
  const jobs: Job[] = [];
  for (const file of files) {
    try {
      jobs.push(JobSchema.parse(parseYaml(fs.readFileSync(path.join(jobsDir(home), file), 'utf8'))));
    } catch {
      // a hand-broken job file never takes the scheduler down; `aeos job list` shows the rest
    }
  }
  return jobs;
}

export function deleteJob(home: string, id: string): boolean {
  try {
    fs.rmSync(jobPath(home, id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Is a job due at `now`? Cron: the first scheduled time after the last run
 * (or after creation) has passed — however many slots were missed while
 * the daemon was down, the job fires ONCE (no thundering catch-up).
 * Idle: the daemon has been idle long enough and the min interval passed.
 */
export function isJobDue(job: Job, now: Date, idleForMs: number): boolean {
  if (!job.enabled) return false;
  const last = job.lastRunAt ?? job.createdAt;
  if (job.kind === 'cron') {
    const next = CronExpressionParser.parse(job.cron as string, { currentDate: new Date(last), tz: 'UTC' }).next().toDate();
    return next.getTime() <= now.getTime();
  }
  const sinceLast = job.lastRunAt === undefined ? Number.POSITIVE_INFINITY : now.getTime() - Date.parse(job.lastRunAt);
  return idleForMs >= (job.idleMs as number) && sinceLast >= (job.minIntervalMs ?? 0);
}

export interface WakeupSchedulerOptions {
  home: string;
  run: (job: Job) => Promise<void>;
  /** How long the daemon has been idle (no running objective), in ms. */
  idleForMs?: () => number;
  now?: () => Date;
}

export interface WakeupScheduler {
  /** Evaluate every job once; returns the ids that fired. */
  tick(): Promise<string[]>;
  start(intervalMs: number): void;
  stop(): void;
}

/**
 * Durable wakeup scheduler (P3.M5.T1). Jobs are files; `lastRunAt` is
 * written BEFORE the action runs, so a crash mid-action never re-fires it
 * in a loop (at-most-once per slot). The first tick on boot catches up any
 * slot missed while the daemon was down.
 */
export function createWakeupScheduler(opts: WakeupSchedulerOptions): WakeupScheduler {
  const now = opts.now ?? (() => new Date());
  let timer: NodeJS.Timeout | undefined;
  let ticking = false;
  const tick = async (): Promise<string[]> => {
    if (ticking) return [];
    ticking = true;
    const fired: string[] = [];
    try {
      const at = now();
      for (const job of listJobs(opts.home)) {
        if (!isJobDue(job, at, opts.idleForMs?.() ?? 0)) continue;
        const { lastError: _dropped, ...rest } = job;
        saveJob(opts.home, { ...rest, lastRunAt: at.toISOString() });
        fired.push(job.id);
        try {
          await opts.run(job);
        } catch (error) {
          saveJob(opts.home, { ...rest, lastRunAt: at.toISOString(), lastError: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      ticking = false;
    }
    return fired;
  };
  return {
    tick,
    start(intervalMs) {
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
    },
  };
}
