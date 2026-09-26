import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JobActionSchema, deleteJob, listJobs, saveJob } from '@aeos/scheduler';
import { getAgent } from '@aeos/kernel';
import { ApiError, ok } from '../envelope.js';
import type { ApiContext } from '../server.js';

const CreateJob = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  kind: z.enum(['cron', 'idle']),
  cron: z.string().min(1).optional(),
  idleMs: z.number().int().positive().optional(),
  minIntervalMs: z.number().int().nonnegative().optional(),
  action: JobActionSchema,
  enabled: z.boolean().default(true),
});

/**
 * Durable wakeup jobs (P3.M5.T1, spec §12): files under `<home>/jobs`,
 * fired by the daemon's wakeup scheduler — also after a restart.
 */
export function registerJobRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/v1/jobs', {
    schema: { description: 'List durable wakeup jobs (cron + idle).', tags: ['jobs'] },
    handler: () => ok(listJobs(ctx.home)),
  });

  app.post('/v1/jobs', {
    schema: { description: 'Create or replace a wakeup job. Cron is 5-field, UTC.', tags: ['jobs'] },
    handler: (request, reply) => {
      const body = CreateJob.parse(request.body);
      if (body.action.type === 'start-objective') getAgent(ctx.home, body.action.workspaceId, body.action.agentId);
      const existing = listJobs(ctx.home).find((j) => j.id === body.id);
      let job;
      try {
        job = saveJob(ctx.home, { ...body, createdAt: existing?.createdAt ?? new Date().toISOString() });
      } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : String(error));
      }
      reply.status(201);
      return ok(job);
    },
  });

  app.delete<{ Params: { id: string } }>('/v1/jobs/:id', {
    schema: { description: 'Delete a wakeup job.', tags: ['jobs'] },
    handler: (request) => {
      if (!deleteJob(ctx.home, request.params.id)) throw new ApiError(404, `no job "${request.params.id}"`);
      return ok({ deleted: request.params.id });
    },
  });
}
