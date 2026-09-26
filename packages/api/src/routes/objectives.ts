import { appendFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentDir, getAgent, writeFileAtomic } from '@aeos/kernel';
import { rename } from 'node:fs/promises';
import {
  commitTaskWork,
  composePlanningPrompt,
  ensureObjectiveWorktree,
  generatePlan,
  parsePlan,
  readCheckpoints,
  renderPlanMarkdown,
  runObjective,
  type ObjectiveOutcome,
  type ObjectiveWorktree,
} from '@aeos/scheduler';
import { compilePolicy, readObjectiveFile } from '@aeos/policy';
import {
  AeosEventSchema,
  ObjectiveSchema,
  newEventId,
  type AeosEvent,
  type AgentConfig,
  type CompiledPolicy,
  type EffectivePolicy,
  PERMISSION_TIERS,
} from '@aeos/contracts';
import type { HarnessAdapter } from '@aeos/provider-core';
import {
  appendRouteRecord,
  estimateUsd,
  loadPricingIndex,
  loadRoutingPolicy,
  readRouteRecords,
  routeTask,
  type LoadedPricing,
  type RouteDecision,
  type RoutedProvider,
} from '@aeos/router';
import { composeSessionBrief, taskNotesPath } from '../brief.js';
import { statusTrackerFor } from '../status.js';
import { guardAdapter } from '../policy-gate.js';
import { ApiError, ok } from '../envelope.js';
import type { ApiContext } from '../server.js';

const ObjectiveRef = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
});

const CreateObjective = ObjectiveRef.extend({
  id: z.string().min(1),
  title: z.string().min(1),
  tasks: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) })).default([]),
  /**
   * No hand-written tasks: the planner (a model call, spec §12) proposes a
   * classed plan on first start, gated by the `run_plan` policy tier.
   */
  autoPlan: z.boolean().default(false),
  /** Objective-scope spend caps (spec §11); persisted as objective.yaml. */
  budgetUsd: z.number().positive().optional(),
  budgetTokens: z.number().int().positive().optional(),
  definitionOfDone: z.string().min(1).optional(),
  /** Repo binding id — the objective runs in its own worktree of that repo (spec §10). */
  repo: z.string().min(1).optional(),
}).refine((body) => body.tasks.length > 0 || body.autoPlan, {
  message: 'give at least one task, or set autoPlan: true to have the planner write the plan',
});

export const proposedPlanPath = (dir: string): string => path.join(dir, 'plan.proposed.md');
const PLAN_PENDING_NOTE = '_No tasks yet — the planner proposes them when this objective starts._';

/** Promote a proposed plan to the plan of record (human or policy approval). */
async function promoteProposedPlan(dir: string): Promise<void> {
  await rename(proposedPlanPath(dir), path.join(dir, 'plan.md'));
}

/** Objective title of record: objective.yaml when present, else objective.md's heading. */
async function objectiveTitle(dir: string, fallback: string): Promise<string> {
  const file = readObjectiveFile(dir);
  if (file !== undefined) return file.title;
  const md = await readFile(path.join(dir, 'objective.md'), 'utf8').catch(() => '');
  return /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? fallback;
}

/** The worktree an objective runs in, created on first run (idempotent). */
export async function objectiveWorktree(
  ctx: Pick<ApiContext, 'home'>,
  agent: AgentConfig,
  objectiveId: string,
): Promise<ObjectiveWorktree | undefined> {
  const dir = objectiveDirFor(ctx.home, agent.workspaceId, agent.id, objectiveId);
  const repoId = readObjectiveFile(dir)?.repo;
  if (repoId === undefined) return undefined;
  const repo = agent.repos?.find((r) => r.id === repoId);
  if (repo === undefined) {
    throw new ApiError(409, `objective "${objectiveId}" targets repo "${repoId}", which agent "${agent.id}" no longer binds`);
  }
  return ensureObjectiveWorktree({
    repo,
    agentDir: agentDir(ctx.home, agent.workspaceId, agent.id),
    agentId: agent.id,
    objectiveId,
  });
}

export const objectiveDirFor = (
  home: string,
  workspaceId: string,
  agentId: string,
  objectiveId: string,
): string => path.join(agentDir(home, workspaceId, agentId), 'objectives', objectiveId);

/** In-flight objective runs, keyed by objective dir — one at a time each. */
const running = new Map<string, Promise<unknown>>();

export const stopFilePath = (home: string): string => path.join(home, 'STOP');

interface PlanPhaseInput {
  ctx: ApiContext;
  agent: AgentConfig;
  dir: string;
  objectiveId: string;
  title: string;
  definitionOfDone: string | undefined;
  worktree: ObjectiveWorktree | undefined;
  /** UNGUARDED adapter factory — planning applies its own read-only policy. */
  rawAdapterFor: (provider: RoutedProvider) => HarnessAdapter;
  routePlan: RouteDecision;
  effective: EffectivePolicy | undefined;
  onEvent: (event: AeosEvent) => void;
}

/**
 * Planning is read-only by construction: whatever the agent's posture, the
 * planning session may read files and nothing else — tool calls beyond that
 * are denied (not parked), so a plan never waits on a tool approval.
 */
export function planningPolicy(effective: EffectivePolicy | undefined): EffectivePolicy {
  const tiers = Object.fromEntries(
    PERMISSION_TIERS.map((tier) => [tier, tier === 'read_files' ? 'allow' : 'deny']),
  ) as EffectivePolicy['tiers'];
  return { tiers, confirmTimeoutSeconds: effective?.confirmTimeoutSeconds ?? 300 };
}

const routeEvent = (agentId: string, taskId: string, decision: RouteDecision): AeosEvent =>
  AeosEventSchema.parse({
    v: 1,
    id: newEventId(),
    ts: new Date().toISOString(),
    source: 'router',
    agentId,
    taskId,
    type: 'route.decided',
    payload: {
      taskClass: decision.taskClass,
      provider: decision.provider,
      ...(decision.model === undefined ? {} : { model: decision.model }),
      ...(decision.thinking === undefined ? {} : { thinking: decision.thinking }),
      providerSource: decision.providerSource,
      modelSource: decision.modelSource,
      reason: decision.reason,
    },
  });

const planEvent = (
  type: 'approval.request' | 'approval.resolved',
  agentId: string,
  sessionId: string,
  payload: Record<string, unknown>,
): AeosEvent =>
  AeosEventSchema.parse({
    v: 1,
    id: newEventId(),
    ts: new Date().toISOString(),
    source: 'planner',
    agentId,
    sessionId,
    type,
    payload,
  });

/**
 * P3.M1.T2 — objective → plan with a policy-gated approval (spec §12).
 * A plan with tasks is `ready`. Otherwise the planner proposes one
 * (`plan.proposed.md`, reused if a proposal already waits) and `run_plan`
 * decides: allow → promote and run; deny → stay proposal-only; confirm →
 * an approval in the shared inbox (7-day window — a plan is worth waiting
 * for; a human can also promote it later via `/plan/approve`).
 */
async function planIfNeeded(input: PlanPhaseInput): Promise<'ready' | ObjectiveOutcome> {
  const { ctx, agent, dir, objectiveId, onEvent } = input;
  const plan = parsePlan(await readFile(path.join(dir, 'plan.md'), 'utf8'));
  if (plan.tasks.length > 0) return 'ready';

  const sessionId = `planner-${objectiveId}`;
  let proposed = await readFile(proposedPlanPath(dir), 'utf8').catch(() => undefined);
  if (proposed === undefined) {
    const readOnly = planningPolicy(input.effective);
    onEvent(routeEvent(agent.id, 'plan', input.routePlan));
    const generated = await generatePlan({
      adapter: guardAdapter(input.rawAdapterFor(input.routePlan.provider), readOnly),
      model: input.routePlan.model,
      agent,
      sessionId: newEventId(),
      prompt: composePlanningPrompt({
        objectiveTitle: input.title,
        definitionOfDone: input.definitionOfDone,
        worktree: input.worktree?.dir,
      }),
      workdir: input.worktree?.dir,
      permissionPolicy: compilePolicy(readOnly),
      onEvent,
    });
    proposed = renderPlanMarkdown(input.title, generated.tasks, `_Proposed by the planner for objective \`${objectiveId}\`._`);
    await writeFileAtomic(proposedPlanPath(dir), proposed);
  }
  const tasks = parsePlan(proposed).tasks;
  const summary = tasks.map((t) => `${t.id} [${t.taskClass}] ${t.title}`).join('; ');
  const mode = input.effective?.tiers.run_plan ?? 'allow'; // no policy wired = trusted local mode
  if (mode === 'allow') {
    await promoteProposedPlan(dir);
    return 'ready';
  }
  if (mode === 'deny' || ctx.approvals === undefined) {
    return {
      status: 'paused',
      taskId: 'plan',
      reason:
        mode === 'deny'
          ? 'run_plan denied by policy — review plan.proposed.md and approve it manually'
          : 'plan awaits approval (no approvals inbox wired)',
    };
  }
  const request = ctx.approvals.request({
    sessionId,
    tier: 'run_plan',
    detail: `plan for ${objectiveId}: ${summary}`.slice(0, 500),
    expiresAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  onEvent(
    planEvent('approval.request', agent.id, sessionId, {
      requestId: request.requestId,
      action: 'run_plan',
      detail: `plan for ${objectiveId}: ${summary}`.slice(0, 500),
      expiresAt: request.expiresAt,
    }),
  );
  const outcome = await request.outcome;
  onEvent(planEvent('approval.resolved', agent.id, sessionId, { requestId: request.requestId, decision: outcome.decision, by: outcome.by }));
  if (outcome.decision !== 'approved') {
    return { status: 'paused', taskId: 'plan', reason: `plan ${outcome.decision} — edit plan.proposed.md and approve, or restart to re-request` };
  }
  await promoteProposedPlan(dir);
  return 'ready';
}

/**
 * Start (or resume) one objective through the sequential scheduler —
 * shared by the route and the daemon's resume-on-boot scan. Idempotent
 * while a run is in flight.
 */
export function startObjectiveRun(
  ctx: ApiContext,
  workspaceId: string,
  agentId: string,
  objectiveId: string,
): void {
  const agent = getAgent(ctx.home, workspaceId, agentId);
  const dir = objectiveDirFor(ctx.home, workspaceId, agentId, objectiveId);
  if (running.has(dir)) return;
  // P2.M10 attention status: every run event folds into the agent's status
  const tracker = statusTrackerFor(ctx.home, ctx.bus);
  const ref = { workspaceId, id: agentId };
  tracker.set(ref, 'working', { via: 'events', reason: `objective ${objectiveId} started` });
  const run = (async () => {
    let permissionPolicy: CompiledPolicy | undefined;
    let effective: EffectivePolicy | undefined;
    if (ctx.policyFor !== undefined) {
      effective = await ctx.policyFor(agent);
      permissionPolicy = compilePolicy(effective);
    }
    // P3.M2 router: one (policy-guarded) adapter per provider the plan routes to
    const rawAdapterFor = (provider: RoutedProvider): HarnessAdapter =>
      provider === agent.harness.provider ? ctx.adapterFor(agent) : ctx.adapterFor(agent, { provider });
    const guarded = new Map<RoutedProvider, HarnessAdapter>();
    const adapterFor = (provider: RoutedProvider): HarnessAdapter => {
      let cached = guarded.get(provider);
      if (cached === undefined) {
        cached =
          effective === undefined
            ? rawAdapterFor(provider)
            : guardAdapter(rawAdapterFor(provider), effective, {
                ...(ctx.approvals === undefined ? {} : { registry: ctx.approvals }),
                ...(ctx.injectSecrets === undefined ? {} : { inject: ctx.injectSecrets }),
              });
        guarded.set(provider, cached);
      }
      return cached;
    };
    const adapter = adapterFor(agent.harness.provider);
    const routing = loadRoutingPolicy(ctx.home, workspaceId);
    const pricing: LoadedPricing = await (ctx.pricing?.() ?? loadPricingIndex({ home: ctx.home, offline: true }));
    const decisions = new Map<string, { decision: RouteDecision; adapter: HarnessAdapter }>();
    const worktree = await objectiveWorktree(ctx, agent, objectiveId);
    const objective = readObjectiveFile(dir);
    const title = await objectiveTitle(dir, objectiveId);
    const onEvent = (event: AeosEvent): void => {
      ctx.bus?.publish(event);
      tracker.observe(ref, event);
      // files are truth for spend too: every cost.usage lands in costs.ndjson
      if (event.type === 'cost.usage') {
        void appendFile(path.join(dir, 'costs.ndjson'), JSON.stringify(event) + '\n');
      }
    };

    // P3.M1 planning phase: an objective with no tasks gets a planner-written plan
    const planned = await planIfNeeded({
      ctx,
      agent,
      dir,
      objectiveId,
      title,
      definitionOfDone: objective?.definitionOfDone,
      worktree,
      rawAdapterFor,
      routePlan: routeTask(agent, 'plan', routing),
      effective,
      onEvent,
    });
    if (planned !== 'ready') return planned;

    return runObjective({
      objectiveDir: dir,
      agent,
      adapter,
      stopFile: stopFilePath(ctx.home),
      composePrompt: async (task, plan) =>
        composeSessionBrief({
          taskNotes: await readFile(taskNotesPath(dir, task.id), 'utf8').catch(() => undefined),
          agent,
          objectiveTitle: title,
          objective,
          task,
          plan,
          memoryRoot: path.join(agentDir(ctx.home, workspaceId, agentId), 'memory'),
          worktree,
        }),
      ...(worktree === undefined
        ? {}
        : {
            workdir: worktree.dir,
            commitTask: (task) =>
              commitTaskWork(worktree.dir, `${task.id}: ${task.title}\n\nAEOS objective ${objectiveId}`, {
                name: agent.name,
                email: `${agent.id}@agents.aeos.local`,
              }),
          }),
      ...(permissionPolicy === undefined ? {} : { permissionPolicy }),
      selectExecution: (task) => {
        const decision = routeTask(agent, task.taskClass, routing);
        const chosen = adapterFor(decision.provider);
        decisions.set(task.id, { decision, adapter: chosen });
        onEvent({ ...routeEvent(agent.id, task.id, decision) });
        return Promise.resolve({ adapter: chosen, model: decision.model });
      },
      onTaskSettled: (task, result) => {
        const routed = decisions.get(task.id);
        if (routed === undefined) return;
        const reportsUsd = routed.adapter.capabilities().costUsd !== false;
        const derived = reportsUsd ? undefined : estimateUsd(pricing, routed.decision.model, result.tokens);
        appendRouteRecord(dir, {
          ts: new Date().toISOString(),
          taskId: task.id,
          decision: routed.decision,
          pricingSource: pricing.source,
          pricingStale: pricing.stale,
          realized: { ...result, ...(derived === undefined ? {} : { derivedUsd: derived }) },
        });
      },
      onEvent,
    });
  })()
    .then(
      (outcome) => {
        if (outcome.status === 'completed') {
          tracker.set(ref, 'done', { via: 'events', reason: `objective ${objectiveId} completed` });
        } else {
          tracker.set(ref, 'blocked', { via: 'events', reason: `objective ${objectiveId} paused: ${outcome.reason}` });
        }
        return outcome;
      },
      (error: unknown) => {
        tracker.set(ref, 'blocked', {
          via: 'events',
          reason: `objective ${objectiveId} errored: ${error instanceof Error ? error.message : String(error)}`,
        });
        throw error;
      },
    )
    .finally(() => running.delete(dir));
  running.set(dir, run);
  run.catch(() => undefined); // surfaced via status; never an unhandled rejection
}

/**
 * Resume-on-boot (spec §12): restart every objective whose plan still has
 * incomplete, unblocked tasks. State is file-derived, so this is safe to
 * call on every daemon start.
 */
export async function resumeIncompleteObjectives(ctx: ApiContext): Promise<string[]> {
  const resumed: string[] = [];
  const { listWorkspaces, listAgents } = await import('@aeos/kernel');
  for (const workspace of listWorkspaces(ctx.home)) {
    for (const agent of listAgents(ctx.home, workspace.id)) {
      const objectivesRoot = path.join(agentDir(ctx.home, workspace.id, agent.id), 'objectives');
      let ids: string[];
      try {
        ids = (await readdir(objectivesRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        continue;
      }
      for (const objectiveId of ids) {
        try {
          const plan = parsePlan(
            await readFile(path.join(objectivesRoot, objectiveId, 'plan.md'), 'utf8'),
          );
          // a planner proposal left waiting across a restart re-requests its approval
          const awaitingPlan =
            plan.tasks.length === 0 &&
            (await stat(proposedPlanPath(path.join(objectivesRoot, objectiveId))).then(
              () => true,
              () => false,
            ));
          const incomplete =
            awaitingPlan || plan.tasks.some((task) => task.status !== 'completed' && task.status !== 'blocked');
          if (incomplete) {
            startObjectiveRun(ctx, workspace.id, agent.id, objectiveId);
            resumed.push(`${workspace.id}/${agent.id}/${objectiveId}`);
          }
        } catch {
          // objectives without a parseable plan are skipped, never fatal
        }
      }
    }
  }
  return resumed;
}

export function registerObjectiveRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.post('/v1/objectives', {
    schema: { description: 'Create an objective with its plan.md.', tags: ['objectives'] },
    handler: async (request, reply) => {
      const body = CreateObjective.parse(request.body);
      const agent = getAgent(ctx.home, body.workspaceId, body.agentId); // 404 via RegistryError if missing
      if (body.repo !== undefined && agent.repos?.some((r) => r.id === body.repo) !== true) {
        throw new ApiError(400, `agent "${agent.id}" has no repo binding "${body.repo}"`);
      }
      const dir = objectiveDirFor(ctx.home, body.workspaceId, body.agentId, body.id);
      await mkdir(path.join(dir, 'checkpoints'), { recursive: true });
      await writeFileAtomic(
        path.join(dir, 'objective.md'),
        `# ${body.title}\n${body.definitionOfDone === undefined ? '' : `\n## Definition of done\n\n${body.definitionOfDone}\n`}`,
      );
      const { stringify } = await import('yaml');
      const objectiveFile = ObjectiveSchema.parse({
        id: body.id,
        agentId: body.agentId,
        title: body.title,
        ...(body.definitionOfDone === undefined ? {} : { definitionOfDone: body.definitionOfDone }),
        ...(body.repo === undefined ? {} : { repo: body.repo }),
        ...(body.budgetUsd === undefined ? {} : { budgetUsd: body.budgetUsd }),
        ...(body.budgetTokens === undefined ? {} : { budgetTokens: body.budgetTokens }),
      });
      await writeFileAtomic(path.join(dir, 'objective.yaml'), stringify(objectiveFile));
      await writeFileAtomic(
        path.join(dir, 'plan.md'),
        body.tasks.length === 0
          ? `# ${body.title}\n\n${PLAN_PENDING_NOTE}\n`
          : `# ${body.title}\n\n${body.tasks.map((t) => `- [ ] **${t.id}** ${t.title}`).join('\n')}\n`,
      );
      await rm(proposedPlanPath(dir), { force: true });
      reply.status(201);
      return ok({ id: body.id, dir });
    },
  });

  app.post<{ Params: { id: string } }>('/v1/objectives/:id/start', {
    schema: {
      description:
        'Start (or resume) the objective through the sequential scheduler. Idempotent while running.',
      tags: ['objectives'],
    },
    handler: async (request) => {
      const { workspaceId, agentId } = ObjectiveRef.parse(request.query);
      const dir = objectiveDirFor(ctx.home, workspaceId, agentId, request.params.id);
      try {
        await readFile(path.join(dir, 'plan.md'), 'utf8');
      } catch {
        throw new ApiError(404, `objective "${request.params.id}" has no plan.md`);
      }
      const stopped = await stat(stopFilePath(ctx.home)).then(
        () => true,
        () => false,
      );
      if (stopped) {
        throw new ApiError(409, 'STOP file present — kill switch engaged (DELETE /v1/stop to resume operations)');
      }
      startObjectiveRun(ctx, workspaceId, agentId, request.params.id);
      return ok({ started: true });
    },
  });

  app.get('/v1/stop', {
    schema: { description: 'Kill-switch status.', tags: ['stop'] },
    handler: async () =>
      ok({
        stopped: await stat(stopFilePath(ctx.home)).then(
          () => true,
          () => false,
        ),
      }),
  });

  app.post('/v1/stop', {
    schema: {
      description:
        'Engage the kill switch: creates <AEOS_HOME>/STOP. Running tasks finish their current session; nothing new spawns (spec §18).',
      tags: ['stop'],
    },
    handler: async () => {
      await writeFileAtomic(stopFilePath(ctx.home), `stopped at ${new Date().toISOString()}\n`);
      return ok({ stopped: true });
    },
  });

  app.delete('/v1/stop', {
    schema: { description: 'Lift the kill switch (removes the STOP file).', tags: ['stop'] },
    handler: async () => {
      await rm(stopFilePath(ctx.home), { force: true });
      return ok({ stopped: false });
    },
  });

  app.get<{ Params: { id: string } }>('/v1/objectives/:id/routes', {
    schema: {
      description: 'Router decisions + realized cost per task attempt (routes.ndjson, P3.M2).',
      tags: ['objectives'],
    },
    handler: (request) => {
      const { workspaceId, agentId } = ObjectiveRef.parse(request.query);
      getAgent(ctx.home, workspaceId, agentId);
      return ok(readRouteRecords(objectiveDirFor(ctx.home, workspaceId, agentId, request.params.id)));
    },
  });

  app.post<{ Params: { id: string } }>('/v1/objectives/:id/plan/approve', {
    schema: {
      description:
        'Human approval of a planner-proposed plan (plan.proposed.md → plan.md), then start. Works after a denial or expiry too.',
      tags: ['objectives'],
    },
    handler: async (request) => {
      const { workspaceId, agentId } = ObjectiveRef.parse(request.query);
      getAgent(ctx.home, workspaceId, agentId);
      const dir = objectiveDirFor(ctx.home, workspaceId, agentId, request.params.id);
      const proposed = await readFile(proposedPlanPath(dir), 'utf8').catch(() => undefined);
      if (proposed === undefined) throw new ApiError(404, `objective "${request.params.id}" has no proposed plan`);
      if (running.has(dir)) throw new ApiError(409, 'objective is running — answer its pending run_plan approval instead');
      await promoteProposedPlan(dir);
      startObjectiveRun(ctx, workspaceId, agentId, request.params.id);
      return ok({ approved: true, tasks: parsePlan(proposed).tasks });
    },
  });

  app.get<{ Params: { id: string } }>('/v1/objectives/:id', {
    schema: {
      description: 'Objective status derived from plan.md + checkpoints (files are truth).',
      tags: ['objectives'],
    },
    handler: async (request) => {
      const { workspaceId, agentId } = ObjectiveRef.parse(request.query);
      const dir = objectiveDirFor(ctx.home, workspaceId, agentId, request.params.id);
      let planRaw: string;
      try {
        planRaw = await readFile(path.join(dir, 'plan.md'), 'utf8');
      } catch {
        throw new ApiError(404, `objective "${request.params.id}" not found`);
      }
      const plan = parsePlan(planRaw);
      const checkpoints = await readCheckpoints(dir);
      const proposed = await readFile(proposedPlanPath(dir), 'utf8').catch(() => undefined);
      return ok({
        running: running.has(dir),
        tasks: plan.tasks,
        checkpoints: [...checkpoints.values()],
        ...(proposed === undefined ? {} : { proposedTasks: parsePlan(proposed).tasks }),
      });
    },
  });
}
