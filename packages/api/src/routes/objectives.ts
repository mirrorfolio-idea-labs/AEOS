import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentDir, getAgent, writeFileAtomic } from '@aeos/kernel';
import { parsePlan, readCheckpoints, runObjective } from '@aeos/scheduler';
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
});

export const objectiveDirFor = (
  home: string,
  workspaceId: string,
  agentId: string,
  objectiveId: string,
): string => path.join(agentDir(home, workspaceId, agentId), 'objectives', objectiveId);

/** In-flight objective runs, keyed by objective dir — one at a time each. */
const running = new Map<string, Promise<unknown>>();

export function registerObjectiveRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.post('/v1/objectives', {
    schema: { description: 'Create an objective with its plan.md.', tags: ['objectives'] },
    handler: async (request, reply) => {
      const body = CreateObjective.parse(request.body);
      getAgent(ctx.home, body.workspaceId, body.agentId); // 404 via RegistryError if missing
      const dir = objectiveDirFor(ctx.home, body.workspaceId, body.agentId, body.id);
      await mkdir(path.join(dir, 'checkpoints'), { recursive: true });
      await writeFileAtomic(path.join(dir, 'objective.md'), `# ${body.title}\n`);
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
      const agent = getAgent(ctx.home, workspaceId, agentId);
      const dir = objectiveDirFor(ctx.home, workspaceId, agentId, request.params.id);
      try {
        await readFile(path.join(dir, 'plan.md'), 'utf8');
      } catch {
        throw new ApiError(404, `objective "${request.params.id}" has no plan.md`);
      }
      if (!running.has(dir)) {
        const run = runObjective({
          objectiveDir: dir,
          agent,
          adapter: ctx.adapterFor(agent),
          onEvent: (event) => {
            ctx.bus?.publish(event);
            // files are truth for spend too: every cost.usage lands in costs.ndjson
            if (event.type === 'cost.usage') {
              void appendFile(path.join(dir, 'costs.ndjson'), JSON.stringify(event) + '\n');
            }
          },
        }).finally(() => running.delete(dir));
        running.set(dir, run);
        run.catch(() => undefined); // surfaced via status; never an unhandled rejection
      }
      return ok({ started: true });
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
