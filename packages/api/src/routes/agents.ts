import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AgentConfigSchema } from '@aeos/contracts';
import { createAgent, getAgent, listAgents, updateAgent } from '@aeos/kernel';
import { ok } from '../envelope.js';
import type { ApiContext } from '../server.js';

const WorkspaceQuery = z.object({ workspaceId: z.string().min(1) });

export function registerAgentRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/v1/agents', {
    schema: { description: 'List agents in a workspace.', tags: ['agents'] },
    handler: (request) => {
      const { workspaceId } = WorkspaceQuery.parse(request.query);
      return ok(listAgents(ctx.home, workspaceId));
    },
  });

  app.get<{ Params: { id: string } }>('/v1/agents/:id', {
    schema: { description: 'Get one agent.', tags: ['agents'] },
    handler: (request) => {
      const { workspaceId } = WorkspaceQuery.parse(request.query);
      return ok(getAgent(ctx.home, workspaceId, request.params.id));
    },
  });

  app.post('/v1/agents', {
    schema: { description: 'Create an agent (registry-backed, git-initialized).', tags: ['agents'] },
    handler: async (request, reply) => {
      const config = AgentConfigSchema.parse(request.body);
      reply.status(201);
      return ok(createAgent(ctx.home, ctx.db, config));
    },
  });

  app.post<{ Params: { id: string } }>('/v1/agents/:id/credential-profile', {
    schema: {
      description:
        'BYOK on-the-go switch (spec §14): point the agent at another credential profile; takes effect next spawn.',
      tags: ['agents'],
    },
    handler: (request) => {
      const { workspaceId } = WorkspaceQuery.parse(request.query);
      const { credentialProfileId } = z
        .object({ credentialProfileId: z.string().min(1) })
        .parse(request.body);
      const updated = updateAgent(ctx.home, ctx.db, workspaceId, request.params.id, {
        credentialProfileId,
      });
      return ok(updated);
    },
  });
}
