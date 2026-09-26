import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAgent, writeFileAtomic } from '@aeos/kernel';
import { parsePlan, worktreeDiff } from '@aeos/scheduler';
import { taskNotesPath } from '../brief.js';
import { ApiError, ok } from '../envelope.js';
import type { ApiContext } from '../server.js';
import { objectiveDirFor, objectiveWorktree, startObjectiveRun } from './objectives.js';

const ObjectiveRef = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
});

const DiffQuery = ObjectiveRef.extend({
  scope: z.enum(['uncommitted', 'branch', 'last-commit']).default('branch'),
});

const ReviewBody = z.object({
  comments: z
    .array(
      z.object({
        file: z.string().min(1).optional(),
        line: z.number().int().positive().optional(),
        body: z.string().min(1),
      }),
    )
    .min(1),
  /** Start the objective right away so the agent picks the review task up. */
  start: z.boolean().default(true),
});

function renderReview(comments: z.infer<typeof ReviewBody>['comments']): string {
  const lines = ['## Review feedback to address', ''];
  for (const c of comments) {
    const where = c.file === undefined ? 'General' : `\`${c.file}${c.line === undefined ? '' : `:${String(c.line)}`}\``;
    lines.push(`- ${where}: ${c.body.replace(/\n/g, '\n  ')}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Review pane backend (herdr-reviewr idea, MIT — adapted to AEOS): diff an
 * objective's worktree in three scopes, and send line comments back to the
 * agent as a new plan task whose notes carry the comments. Files are truth:
 * the review lands in plan.md + tasks/<id>.md, so it survives restarts.
 */
export function registerReviewRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get<{ Params: { id: string } }>('/v1/objectives/:id/diff', {
    schema: {
      description: 'Unified diff of the objective worktree: uncommitted | branch (since the objective began) | last-commit.',
      tags: ['objectives'],
    },
    handler: async (request) => {
      const { workspaceId, agentId, scope } = DiffQuery.parse(request.query);
      const agent = getAgent(ctx.home, workspaceId, agentId);
      const worktree = await objectiveWorktree(ctx, agent, request.params.id);
      if (worktree === undefined) {
        throw new ApiError(404, `objective "${request.params.id}" has no repo worktree`);
      }
      const diff = await worktreeDiff(worktree.dir, scope, worktree.baseCommit);
      return ok({ scope, branch: worktree.branch, worktree: worktree.dir, baseCommit: worktree.baseCommit, diff });
    },
  });

  app.post<{ Params: { id: string } }>('/v1/objectives/:id/review', {
    schema: {
      description:
        'Send review comments back to the agent: appends an R<n> task to plan.md with the comments as its notes, then (by default) starts the objective.',
      tags: ['objectives'],
    },
    handler: async (request, reply) => {
      const { workspaceId, agentId } = ObjectiveRef.parse(request.query);
      const body = ReviewBody.parse(request.body);
      getAgent(ctx.home, workspaceId, agentId);
      const dir = objectiveDirFor(ctx.home, workspaceId, agentId, request.params.id);
      let planRaw: string;
      try {
        planRaw = await readFile(path.join(dir, 'plan.md'), 'utf8');
      } catch {
        throw new ApiError(404, `objective "${request.params.id}" not found`);
      }
      const plan = parsePlan(planRaw);
      const taken = new Set(plan.tasks.map((t) => t.id));
      let n = 1;
      while (taken.has(`R${String(n)}`)) n += 1;
      const taskId = `R${String(n)}`;
      const title = `Address review feedback (${String(body.comments.length)} comment${body.comments.length === 1 ? '' : 's'})`;
      await mkdir(path.join(dir, 'tasks'), { recursive: true });
      await writeFileAtomic(taskNotesPath(dir, taskId), renderReview(body.comments));
      await appendFile(
        path.join(dir, 'plan.md'),
        `${planRaw.endsWith('\n') ? '' : '\n'}- [ ] **${taskId}** ${title}\n`,
      );
      if (body.start) startObjectiveRun(ctx, workspaceId, agentId, request.params.id);
      reply.status(201);
      return ok({ taskId, title, started: body.start });
    },
  });
}
