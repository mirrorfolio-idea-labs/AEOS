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
import { BudgetMeter, diffStatuses, readObjectiveFile, worktreeStatus, type BudgetCaps } from '@aeos/policy';
import type { Objective, PlanTask } from '@aeos/contracts';
import type { HarnessAdapter } from '@aeos/provider-core';
import { parsePlan, serializePlan, withTaskStatus, type ParsedPlan } from './plan.js';
import { readCheckpoints, resolveNextTask, writeCheckpoint } from './checkpoint.js';
import type { VerifyResult } from './verify.js';

const CODE_CLASSES = new Set(['implement', 'refactor', 'rename']);

/** The code task a verify task checks: the nearest earlier implement/refactor/rename. */
function verifiedTaskFor(plan: ParsedPlan, verifyTask: PlanTask): PlanTask | undefined {
  const index = plan.tasks.findIndex((t) => t.id === verifyTask.id);
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = plan.tasks[i] as PlanTask;
    if (CODE_CLASSES.has(candidate.taskClass)) return candidate;
  }
  return index > 0 ? plan.tasks[index - 1] : undefined;
}

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
  /**
   * Co-edit guard repo (ADR-009, spec §20 OQ1): when set and a foreign edit
   * appears in this tree between a task's start and its successful end, the
   * objective pauses behind an approval.request — kill-switch semantics.
   */
  watchedRepo?: string;
  /** Harness cwd — the objective's git worktree (spec §10). */
  workdir?: string;
  /**
   * Builds the session prompt for a task (objective context, memory
   * snapshot, workdir brief). Defaults to the bare task title.
   */
  composePrompt?: (task: PlanTask, plan: ParsedPlan) => Promise<string>;
  /**
   * Seals a completed task's work (e.g. a worktree commit); the returned
   * sha is recorded as the checkpoint's `commit`.
   */
  commitTask?: (task: PlanTask) => Promise<string | undefined>;
  /**
   * Per-task execution choice (P3.M2 router): which adapter (provider)
   * and model run this task. Defaults to `adapter` with the harness model.
   */
  selectExecution?: (
    task: PlanTask,
  ) => Promise<{ adapter: HarnessAdapter; model?: string | undefined; agent?: AgentConfig | undefined }>;
  /**
   * Runs a `verify` task (P3.M3) — daemon-side commands, not a harness
   * session. Pass/flaky completes it; fail takes a strike and re-opens the
   * code task it verifies with the failure notes; `fatal` blocks at once.
   */
  runVerify?: (task: PlanTask) => Promise<VerifyResult>;
  /** Called with the re-opened code task so its next session sees the failure. */
  onVerifyFailed?: (target: PlanTask, verifyTask: PlanTask, result: VerifyResult) => Promise<void>;
  /** Realized outcome + spend of every task attempt (route/cost records). */
  onTaskSettled?: (task: PlanTask, result: TaskSettlement) => void | Promise<void>;
  /**
   * A task's harness session is about to start / has ended (spec §7): lets
   * the host register the session (session.yaml + index) so its events
   * route to a transcript, then record the final state.
   */
  onSessionStarted?: (session: SessionInfo) => void | Promise<void>;
  onSessionEnded?: (session: SessionInfo & { state: 'completed' | 'failed' | 'paused'; providerSessionId?: string }) => void | Promise<void>;
}

export interface SessionInfo {
  sessionId: string;
  /** The agent the session runs as (the delegate, for a delegated task). */
  agent: AgentConfig;
  task: PlanTask;
}

export interface TaskSettlement {
  status: 'completed' | 'failed' | 'paused';
  usd: number;
  tokens: { input: number; output: number };
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

    if (task.taskClass === 'verify' && opts.runVerify !== undefined) {
      const result = await opts.runVerify(task);
      const verification = { outcome: result.outcome, commands: result.commands };
      if (result.fatal !== undefined) {
        await writeCheckpoint(opts.objectiveDir, {
          taskId: task.id,
          status: 'blocked',
          attempts,
          summary: `verification cannot run: ${result.fatal}`,
          costs: { usd: 0, tokens: 0 },
          verification,
        });
        continue; // resolveNextTask now reports it blocked → pause + approval.request
      }
      if (result.outcome !== 'fail') {
        await writeCheckpoint(opts.objectiveDir, {
          taskId: task.id,
          status: 'completed',
          attempts: attempts + 1,
          summary: result.outcome === 'flaky' ? 'verification passed on retry (flaky)' : 'verification passed',
          costs: { usd: 0, tokens: 0 },
          verification,
        });
        await savePlan(opts.objectiveDir, withTaskStatus(plan, task.id, 'completed'));
        continue;
      }
      const strikes = attempts + 1;
      const exhausted = strikes >= maxAttempts;
      await writeCheckpoint(opts.objectiveDir, {
        taskId: task.id,
        status: exhausted ? 'blocked' : 'pending',
        attempts: strikes,
        summary: `verification failed (strike ${String(strikes)} of ${String(maxAttempts)})`,
        costs: { usd: 0, tokens: 0 },
        verification,
      });
      const target = verifiedTaskFor(plan, task);
      if (!exhausted && target !== undefined) {
        // re-open the code task: a fresh session (no resume token) with the failure as notes
        await opts.onVerifyFailed?.(target, task, result);
        await writeCheckpoint(opts.objectiveDir, {
          taskId: target.id,
          status: 'pending',
          attempts: 0,
          summary: `re-opened by ${task.id} verification failure`,
          costs: { usd: 0, tokens: 0 },
        });
        plan = withTaskStatus(plan, target.id, 'pending');
      }
      await savePlan(opts.objectiveDir, withTaskStatus(plan, task.id, exhausted ? 'blocked' : 'pending'));
      if (!exhausted) await backoff(strikes);
      continue;
    }

    // co-edit baseline: everything already dirty here counts as known state
    const baselineStatus =
      opts.watchedRepo !== undefined ? await worktreeStatus(opts.watchedRepo) : undefined;

    const execution = (await opts.selectExecution?.(task)) ?? { adapter: opts.adapter };
    // delegation (P3.M5): a task may run as another agent — its profile, not ours
    const runAs = execution.agent ?? opts.agent;
    const profile = await execution.adapter.createProfile(runAs);
    const sessionId = nextSessionId();
    await opts.onSessionStarted?.({ sessionId, agent: runAs, task });
    const handle = execution.adapter.spawn({
      profile,
      sessionId,
      objective: opts.composePrompt === undefined ? task.title : await opts.composePrompt(task, plan),
      ...(opts.workdir === undefined ? {} : { workdir: opts.workdir }),
      ...(execution.model === undefined ? {} : { model: execution.model }),
      ...(resumeToken === undefined ? {} : { resumeToken }),
      ...(opts.permissionPolicy === undefined ? {} : { permissionPolicy: opts.permissionPolicy }),
    });

    let usd = 0;
    let tokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
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
        inputTokens += event.payload.inputTokens;
        outputTokens += event.payload.outputTokens;
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

    await opts.onSessionEnded?.({
      sessionId,
      agent: runAs,
      task,
      state: budgetStop !== null ? 'paused' : terminal === 'completed' ? 'completed' : 'failed',
      ...(handle.providerSessionId === undefined ? {} : { providerSessionId: handle.providerSessionId }),
    });

    const settle = (status: TaskSettlement['status']): Promise<void> | void =>
      opts.onTaskSettled?.(task, { status, usd, tokens: { input: inputTokens, output: outputTokens } });

    if (budgetStop !== null) {
      await settle('paused');
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

    if (terminal === 'completed' && baselineStatus !== undefined) {
      // co-edit guard (ADR-009): a foreign edit in the watched tree between
      // task start and task end pauses the objective behind an approval —
      // kill-switch semantics (no plan mutation, no strike)
      const changed = diffStatuses(baselineStatus, await worktreeStatus(opts.watchedRepo as string));
      if (changed.length > 0) {
        const detail = `co-edit guard: foreign changes in ${opts.watchedRepo}: ${changed.join(', ')}`;
        emit(
          AeosEventSchema.parse({
            v: 1,
            id: newEventId(),
            ts: new Date().toISOString(),
            source: 'scheduler',
            agentId: opts.agent.id,
            taskId: task.id,
            type: 'approval.request',
            payload: {
              requestId: newEventId(),
              action: 'objective.resume',
              detail,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            },
          }),
        );
        await settle('paused');
        await savePlan(opts.objectiveDir, plan); // T1 stays as written at spawn
        return {
          status: 'paused',
          taskId: task.id,
          reason: `co-edit detected (${String(changed[0])})`,
        };
      }
    }

    if (terminal === 'completed') {
      await settle('completed');
      const commit = await opts.commitTask?.(task);
      await writeCheckpoint(opts.objectiveDir, {
        taskId: task.id,
        status: 'completed',
        attempts: attempts + 1,
        summary: `completed on attempt ${attempts + 1}`,
        costs: { usd, tokens },
        ...(commit === undefined ? {} : { commit }),
        ...(handle.resumeToken === undefined
          ? {}
          : { providerResumeToken: handle.resumeToken }),
      });
      await savePlan(opts.objectiveDir, withTaskStatus(plan, task.id, 'completed'));
      continue;
    }

    await settle('failed');
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
