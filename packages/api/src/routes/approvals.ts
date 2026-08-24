import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, ok } from '../envelope.js';
import type { ApiContext } from '../server.js';

const Decision = z.object({ decision: z.enum(['approve', 'deny']) });

export function registerApprovalRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/v1/approvals', {
    schema: {
      description: 'Pending approval requests (spec §11 approvals flow).',
      tags: ['approvals'],
    },
    handler: async () => {
      if (ctx.approvals === undefined) throw new ApiError(503, 'approvals registry not wired');
      return ok({ pending: ctx.approvals.pending() });
    },
  });

  app.post<{ Params: { requestId: string } }>('/v1/approvals/:requestId', {
    schema: {
      description: 'Answer a pending approval. Unanswered requests deny on expiry.',
      tags: ['approvals'],
    },
    handler: async (request) => {
      if (ctx.approvals === undefined) throw new ApiError(503, 'approvals registry not wired');
      const { decision } = Decision.parse(request.body);
      const by = typeof request.headers['x-aeos-by'] === 'string'
        ? request.headers['x-aeos-by']
        : 'api';
      try {
        ctx.approvals.resolve(request.params.requestId, decision, by);
      } catch {
        throw new ApiError(404, `no pending approval "${request.params.requestId}"`);
      }
      return ok({ resolved: true, decision });
    },
  });
}
