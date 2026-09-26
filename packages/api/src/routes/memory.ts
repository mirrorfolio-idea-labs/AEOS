import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentDir, getAgent } from '@aeos/kernel';
import { AeosEventSchema, newEventId } from '@aeos/contracts';
import {
  applyProposals,
  initMemoryLayout,
  listProposals,
  readIndex,
  rejectProposal,
  rebuildMemoryFts,
  searchMemory,
} from '@aeos/memory';
import { ApiError, ok } from '../envelope.js';
import type { ApiContext } from '../server.js';

const MemoryRef = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
});

const memoryRoot = (ctx: ApiContext, workspaceId: string, agentId: string): string =>
  path.join(agentDir(ctx.home, workspaceId, agentId), 'memory');

export function registerMemoryRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/v1/memory/index', {
    schema: { description: 'MEMORY.md index + budgets (lazily initialized).', tags: ['memory'] },
    handler: async (request) => {
      const { workspaceId, agentId } = MemoryRef.parse(request.query);
      getAgent(ctx.home, workspaceId, agentId);
      const root = memoryRoot(ctx, workspaceId, agentId);
      await initMemoryLayout(root);
      return ok(await readIndex(root));
    },
  });

  app.get('/v1/memory/file', {
    schema: { description: 'Read one memory file by repo-relative path.', tags: ['memory'] },
    handler: async (request) => {
      const { workspaceId, agentId, path: relPath } = MemoryRef.extend({
        path: z.string().min(1),
      }).parse(request.query);
      const root = memoryRoot(ctx, workspaceId, agentId);
      const resolved = path.resolve(root, relPath);
      if (!resolved.startsWith(path.resolve(root) + path.sep)) {
        throw new ApiError(400, 'path escapes the memory root');
      }
      try {
        return ok({ path: relPath, content: await readFile(resolved, 'utf8') });
      } catch {
        throw new ApiError(404, `memory file "${relPath}" not found`);
      }
    },
  });

  app.get('/v1/memory/search', {
    schema: { description: 'FTS search over the agent memory (rebuilds lazily).', tags: ['memory'] },
    handler: async (request) => {
      const { workspaceId, agentId, q, k } = MemoryRef.extend({
        q: z.string().min(1),
        k: z.coerce.number().int().positive().max(50).default(10),
      }).parse(request.query);
      getAgent(ctx.home, workspaceId, agentId);
      const root = memoryRoot(ctx, workspaceId, agentId);
      await initMemoryLayout(root);
      await rebuildMemoryFts(ctx.db, agentId, root);
      return ok(searchMemory(ctx.db, agentId, q, k));
    },
  });

  app.get('/v1/memory/proposals', {
    schema: { description: 'Queued memory proposals (retrospective, curator, agents) awaiting acceptance.', tags: ['memory'] },
    handler: async (request) => {
      const { workspaceId, agentId } = MemoryRef.parse(request.query);
      getAgent(ctx.home, workspaceId, agentId);
      const root = memoryRoot(ctx, workspaceId, agentId);
      await initMemoryLayout(root);
      return ok(await listProposals(root));
    },
  });

  app.post('/v1/memory/proposals/apply', {
    schema: {
      description: 'Accept queued proposals (all, or `ids`) — they take effect in the NEXT session snapshot (spec §8 rule 2).',
      tags: ['memory'],
    },
    handler: async (request) => {
      const { workspaceId, agentId } = MemoryRef.parse(request.query);
      const { ids } = z.object({ ids: z.array(z.string().min(1)).optional() }).parse(request.body ?? {});
      getAgent(ctx.home, workspaceId, agentId);
      const root = memoryRoot(ctx, workspaceId, agentId);
      await initMemoryLayout(root);
      const results = await applyProposals(
        root,
        (written) =>
          ctx.bus?.publish(
            AeosEventSchema.parse({
              v: 1,
              id: newEventId(),
              ts: new Date().toISOString(),
              source: 'api',
              agentId,
              type: 'memory.written',
              payload: { path: written.path, bytes: written.bytes },
            }),
          ),
        ids === undefined ? {} : { ids },
      );
      await rebuildMemoryFts(ctx.db, agentId, root).catch(() => undefined);
      return ok(results);
    },
  });

  app.post<{ Params: { id: string } }>('/v1/memory/proposals/:id/reject', {
    schema: { description: 'Reject (drop) one queued proposal; memory is untouched.', tags: ['memory'] },
    handler: async (request) => {
      const { workspaceId, agentId } = MemoryRef.parse(request.query);
      getAgent(ctx.home, workspaceId, agentId);
      const removed = await rejectProposal(memoryRoot(ctx, workspaceId, agentId), request.params.id);
      if (!removed) throw new ApiError(404, `no queued proposal "${request.params.id}"`);
      return ok({ rejected: request.params.id });
    },
  });
}
