import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AeosEventSchema,
  newEventId,
  type AeosEvent,
  type AgentConfig,
  type CompiledPolicy,
} from '@aeos/contracts';
import { writeFileAtomic } from '@aeos/kernel';
import { BudgetMeter, readObjectiveFile, type BudgetCaps } from '@aeos/policy';
import type { Objective } from '@aeos/contracts';
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
  /** Compiled policy handed to each spawn (spec §11); enforcement is the caller's guard. */
  permissionPolicy?: CompiledPolicy;
  /**
   * Objective-scope spend caps (spec §11). Overrides `<objectiveDir>/
   * objective.yaml` when present. Crossing a cap HARD-STOPS the run: the
   * task's checkpoint returns to `pending` WITHOUT consuming a strike, so
   * raising the cap and re-starting resumes cleanly.
   */
  budget?: BudgetCaps;
  /**
   * Kill switch (spec §18): when this file exists, no further sessions are
   * spawned — the objective pauses before the next task. Runner-level STOP
   * handling (in-flight sessions) shipped with M3.
   */
  stopFile?: string;
}

export type ObjectiveOutcome =
  | { status: 'completed' }
  | { status: 'paused'; taskId: string; reason: string };

const planPath = (objectiveDir: string): string => path.join(objectiveDir, 'plan.md');

function budgetCapsFromFile(file: Objective | undefined): BudgetCaps {
  if (file === undefined) return {};
  return {
    ...(file.budgetUsd === undefined ? {} : { usdCap: file.budgetUsd }),
    ...(file.budgetTokens === undefined ? {} : { tokenCap: file.budgetTokens }),
  };
}

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
  const fileBudget = readObjectiveFile(opts.objectiveDir);
  const caps = opts.budget ?? budgetCapsFromFile(fileBudget);
  const meter = new BudgetMeter(caps);
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
    if (resolution.kind === 'run' && opts.stopFile !== undefined) {
      const stopped = await stat(opts.stopFile).then(
        () => true,
        () => false,
      );
      if (stopped) {
        // Kill switch: pause WITHOUT mutating the plan — removing the STOP
        // file and re-running resumes exactly where we halted.
        await savePlan(opts.objectiveDir, plan);
        return {
          status: 'paused',
          taskId: resolution.task.id,
          reason: `STOP file present (${opts.stopFile}) — kill switch engaged`,
        };
      }
    }

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
      ...(opts.permissionPolicy === undefined ? {} : { permissionPolicy: opts.permissionPolicy }),
    });

    let usd = 0;
    let tokens = 0;
    let terminal: 'completed' | 'failed' | 'none' = 'none';
    let failureReason = 'session ended without a terminal event';
    let budgetStop: { kind: 'usd' | 'tokens'; cap: number; spent: number } | null = null;
    for await (const event of handle.events) {
      // once over cap: drain silently — a hard-stopped session has no side effects
      if (budgetStop === null) emit(event);
      if (event.type === 'cost.usage') {
        const taskTokens = event.payload.inputTokens + event.payload.outputTokens;
        usd += event.payload.usd;
        tokens += taskTokens;
        const reading = meter.record({ usd: event.payload.usd, tokens: taskTokens });
        if (reading.exceeded !== null && budgetStop === null) {
          const kind = reading.exceeded;
          const cap = kind === 'usd' ? (caps.usdCap ?? 0) : (caps.tokenCap ?? 0);
          const spent = kind === 'usd' ? reading.totalUsd : reading.totalTokens;
          budgetStop = { kind, cap, spent };
          emit(
            AeosEventSchema.parse({
              v: 1,
              id: newEventId(),
              ts: new Date().toISOString(),
              source: 'scheduler',
              agentId: opts.agent.id,
              taskId: task.id,
              type: 'budget.exceeded',
              payload: { scope: 'objective', id: opts.objectiveDir, kind, cap, spent },
            }),
          );
        }
      } else if (event.type === 'session.completed') {
        terminal = 'completed';
      } else if (event.type === 'session.failed') {
        terminal = 'failed';
        failureReason = event.payload.reason;
      }
    }

    if (budgetStop !== null) {
      await writeCheckpoint(opts.objectiveDir, {
        taskId: task.id,
        status: 'pending', // NOT a strike: raising the cap resumes cleanly
        attempts,
        summary: `hard-stopped: budget ${budgetStop.kind} cap ${String(budgetStop.cap)} reached at ${String(budgetStop.spent)}`,
        costs: { usd, tokens },
        ...(handle.resumeToken === undefined ? {} : { providerResumeToken: handle.resumeToken }),
      });
      await savePlan(opts.objectiveDir, withTaskStatus(plan, task.id, 'pending'));
      return {
        status: 'paused',
        taskId: task.id,
        reason: `budget ${budgetStop.kind} cap reached`,
      };
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
