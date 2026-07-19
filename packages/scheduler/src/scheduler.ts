import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AeosEventSchema,
  newEventId,
  type AeosEvent,
  type AgentConfig,
} from '@aeos/contracts';
import { writeFileAtomic } from '@aeos/kernel';
import type { HarnessAdapter } from '@aeos/provider-core';
import { parsePlan, serializePlan, withTaskStatus, type ParsedPlan } from './plan.js';
import { readCheckpoints, resolveNextTask, writeCheckpoint } from './checkpoint.js';

export interface RunObjectiveOptions {
  /** Directory holding `plan.md` and `checkpoints/`. */
  objectiveDir: string;
  agent: AgentConfig;
  adapter: HarnessAdapter;
  /** 3-strike default (spec §12). */
  maxAttempts?: number;
  /** Backoff between attempts — injectable so tests run instantly. */
  backoff?: (attempt: number) => Promise<void>;
  /** Receives every session event plus the scheduler's pause event. */
  onEvent?: (event: AeosEvent) => void;
  sessionIdFactory?: () => string;
}

export type ObjectiveOutcome =
  | { status: 'completed' }
  | { status: 'paused'; taskId: string; reason: string };

const planPath = (objectiveDir: string): string => path.join(objectiveDir, 'plan.md');

async function loadPlan(objectiveDir: string): Promise<ParsedPlan> {
  return parsePlan(await readFile(planPath(objectiveDir), 'utf8'));
}

async function savePlan(objectiveDir: string, plan: ParsedPlan): Promise<void> {
  await writeFileAtomic(planPath(objectiveDir), serializePlan(plan));
}

/**
 * Sequential scheduler v0 (spec §12): pick first incomplete task → spawn a
 * session through the provider adapter → checkpoint → advance. All state
 * lives in plan.md + checkpoints/*.yaml, so calling this again after ANY
 * crash resumes at the first non-completed task — transcripts are never
 * replayed. Third consecutive failure of a task blocks it, pauses the
 * objective, and emits an approval.request (action `objective.resume`).
 */
export async function runObjective(opts: RunObjectiveOptions): Promise<ObjectiveOutcome> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoff = opts.backoff ?? (() => Promise.resolve());
  const emit = opts.onEvent ?? (() => undefined);
  const nextSessionId = opts.sessionIdFactory ?? newEventId;

  for (;;) {
    let plan = await loadPlan(opts.objectiveDir);
    const checkpoints = await readCheckpoints(opts.objectiveDir);
    // plan markers may lag after a crash — checkpoints win (spec §12).
    for (const task of plan.tasks) {
      const checkpoint = checkpoints.get(task.id);
      if (checkpoint && checkpoint.status !== task.status) {
        plan = withTaskStatus(plan, task.id, checkpoint.status);
      }
    }
    const resolution = resolveNextTask(plan, checkpoints, maxAttempts);

    if (resolution.kind === 'done') {
      await savePlan(opts.objectiveDir, plan);
      return { status: 'completed' };
    }

    if (resolution.kind === 'paused') {
      plan = withTaskStatus(plan, resolution.task.id, 'blocked');
      await savePlan(opts.objectiveDir, plan);
      emit(
        AeosEventSchema.parse({
          v: 1,
          id: newEventId(),
          ts: new Date().toISOString(),
          source: 'scheduler',
          agentId: opts.agent.id,
          taskId: resolution.task.id,
          type: 'approval.request',
          payload: {
            requestId: newEventId(),
            action: 'objective.resume',
            detail: resolution.reason,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
        }),
      );
      return { status: 'paused', taskId: resolution.task.id, reason: resolution.reason };
    }

    const { task, attempts, resumeToken } = resolution;
    plan = withTaskStatus(plan, task.id, 'in_progress');
    await savePlan(opts.objectiveDir, plan);
    await writeCheckpoint(opts.objectiveDir, {
      taskId: task.id,
      status: 'in_progress',
      attempts,
      summary: `attempt ${attempts + 1} of ${maxAttempts}`,
      costs: { usd: 0, tokens: 0 },
      ...(resumeToken === undefined ? {} : { providerResumeToken: resumeToken }),
    });

    const profile = await opts.adapter.createProfile(opts.agent);
    const handle = opts.adapter.spawn({
      profile,
      sessionId: nextSessionId(),
      objective: task.title,
      ...(resumeToken === undefined ? {} : { resumeToken }),
    });

    let usd = 0;
    let tokens = 0;
    let terminal: 'completed' | 'failed' | 'none' = 'none';
    let failureReason = 'session ended without a terminal event';
    for await (const event of handle.events) {
      emit(event);
      if (event.type === 'cost.usage') {
        usd += event.payload.usd;
        tokens += event.payload.inputTokens + event.payload.outputTokens;
      } else if (event.type === 'session.completed') {
        terminal = 'completed';
      } else if (event.type === 'session.failed') {
        terminal = 'failed';
        failureReason = event.payload.reason;
      }
    }

    if (terminal === 'completed') {
      await writeCheckpoint(opts.objectiveDir, {
        taskId: task.id,
        status: 'completed',
        attempts: attempts + 1,
        summary: `completed on attempt ${attempts + 1}`,
        costs: { usd, tokens },
        ...(handle.resumeToken === undefined
          ? {}
          : { providerResumeToken: handle.resumeToken }),
      });
      await savePlan(opts.objectiveDir, withTaskStatus(plan, task.id, 'completed'));
      continue;
    }

    const nowAttempts = attempts + 1;
    const exhausted = nowAttempts >= maxAttempts;
    await writeCheckpoint(opts.objectiveDir, {
      taskId: task.id,
      status: exhausted ? 'blocked' : 'pending',
      attempts: nowAttempts,
      summary: `attempt ${nowAttempts} failed: ${failureReason}`,
      costs: { usd, tokens },
    });
    if (!exhausted) await backoff(nowAttempts);
  }
}
