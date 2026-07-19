import type { FastifyInstance } from 'fastify';
import { WorkspaceSchema } from '@aeos/contracts';
import { createWorkspace, getWorkspace, listWorkspaces } from '@aeos/kernel';
import { ok } from '../envelope.js';
import type { ApiContext } from '../server.js';

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/v1/workspaces', {
    schema: { description: 'List workspaces.', tags: ['workspaces'] },
    handler: () => ok(listWorkspaces(ctx.home)),
  });

  app.get<{ Params: { id: string } }>('/v1/workspaces/:id', {
    schema: { description: 'Get one workspace.', tags: ['workspaces'] },
    handler: (request) => ok(getWorkspace(ctx.home, request.params.id)),
  });

  app.post('/v1/workspaces', {
    schema: { description: 'Create a workspace.', tags: ['workspaces'] },
    handler: async (request, reply) => {
      const workspace = WorkspaceSchema.parse(request.body);
      reply.status(201);
      return ok(createWorkspace(ctx.home, workspace));
    },
  });
}
