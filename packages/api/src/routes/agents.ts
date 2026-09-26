import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { AgentConfigSchema, RepoBindingSchema } from '@aeos/contracts';
import { createAgent, getAgent, listAgents, updateAgent } from '@aeos/kernel';
import { ApiError, ok } from '../envelope.js';
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

  app.post<{ Params: { id: string } }>('/v1/agents/:id/repos', {
    schema: {
      description:
        'Bind a repository (spec §7): objectives targeting it run in their own git worktree on an aeos/<agent>/<objective> branch — never in the checkout itself.',
      tags: ['agents'],
    },
    handler: (request, reply) => {
      const { workspaceId } = WorkspaceQuery.parse(request.query);
      const binding = RepoBindingSchema.parse(request.body);
      if (!path.isAbsolute(binding.path)) throw new ApiError(400, 'repo path must be absolute');
      try {
        execFileSync('git', ['rev-parse', '--git-dir'], { cwd: binding.path, stdio: 'ignore' });
      } catch {
        throw new ApiError(400, `${binding.path} is not a git repository`);
      }
      const agent = getAgent(ctx.home, workspaceId, request.params.id);
      const repos = [...(agent.repos ?? []).filter((r) => r.id !== binding.id), binding];
      reply.status(201);
      return ok(updateAgent(ctx.home, ctx.db, workspaceId, agent.id, { repos }));
    },
  });

  app.delete<{ Params: { id: string; repoId: string } }>('/v1/agents/:id/repos/:repoId', {
    schema: {
      description: 'Unbind a repository. Existing worktrees and agent branches are left in place.',
      tags: ['agents'],
    },
    handler: (request) => {
      const { workspaceId } = WorkspaceQuery.parse(request.query);
      const agent = getAgent(ctx.home, workspaceId, request.params.id);
      const repos = (agent.repos ?? []).filter((r) => r.id !== request.params.repoId);
      return ok(updateAgent(ctx.home, ctx.db, workspaceId, agent.id, { repos }));
    },
  });
}
