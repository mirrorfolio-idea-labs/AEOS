import { appendFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentDir, getAgent, writeFileAtomic } from '@aeos/kernel';
import {
  commitTaskWork,
  ensureObjectiveWorktree,
  parsePlan,
  readCheckpoints,
  runObjective,
  type ObjectiveWorktree,
} from '@aeos/scheduler';
import { compilePolicy, readObjectiveFile } from '@aeos/policy';
import { ObjectiveSchema, type AgentConfig, type CompiledPolicy } from '@aeos/contracts';
import { composeSessionBrief, taskNotesPath } from '../brief.js';
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
  tasks: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) })).min(1),
  /** Objective-scope spend caps (spec §11); persisted as objective.yaml. */
  budgetUsd: z.number().positive().optional(),
  budgetTokens: z.number().int().positive().optional(),
  definitionOfDone: z.string().min(1).optional(),
  /** Repo binding id — the objective runs in its own worktree of that repo (spec §10). */
  repo: z.string().min(1).optional(),
});

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
  const run = (async () => {
    let adapter = ctx.adapterFor(agent);
    let permissionPolicy: CompiledPolicy | undefined;
    if (ctx.policyFor !== undefined) {
      const effective = await ctx.policyFor(agent);
      adapter = guardAdapter(adapter, effective, {
        ...(ctx.approvals === undefined ? {} : { registry: ctx.approvals }),
        ...(ctx.injectSecrets === undefined ? {} : { inject: ctx.injectSecrets }),
      });
      permissionPolicy = compilePolicy(effective);
    }
    const worktree = await objectiveWorktree(ctx, agent, objectiveId);
    const objective = readObjectiveFile(dir);
    const title = await objectiveTitle(dir, objectiveId);
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
      onEvent: (event) => {
        ctx.bus?.publish(event);
        // files are truth for spend too: every cost.usage lands in costs.ndjson
        if (event.type === 'cost.usage') {
          void appendFile(path.join(dir, 'costs.ndjson'), JSON.stringify(event) + '\n');
        }
      },
    });
  })()
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
          const incomplete = plan.tasks.some(
            (task) => task.status !== 'completed' && task.status !== 'blocked',
          );
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
        `# ${body.title}\n\n${body.tasks.map((t) => `- [ ] **${t.id}** ${t.title}`).join('\n')}\n`,
      );
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
      return ok({
        running: running.has(dir),
        tasks: plan.tasks,
        checkpoints: [...checkpoints.values()],
      });
    },
  });
}
