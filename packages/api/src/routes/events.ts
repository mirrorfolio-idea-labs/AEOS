import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AeosEventSchema, type AeosEvent } from '@aeos/contracts';
import { transcriptPath } from '@aeos/kernel';
import type { ApiContext } from '../server.js';

const EventsQuery = z.object({
  typePrefix: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  /** Backfill anchor (also honored via the Last-Event-ID header). */
  lastEventId: z.string().optional(),
  /** Backfill source — a specific session transcript. */
  workspaceId: z.string().optional(),
});

const sse = (event: AeosEvent): string => `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;

function matches(query: z.infer<typeof EventsQuery>, event: AeosEvent): boolean {
  if (query.typePrefix !== undefined && !event.type.startsWith(query.typePrefix)) return false;
  if (query.agentId !== undefined && event.agentId !== query.agentId) return false;
  if (query.sessionId !== undefined && event.sessionId !== query.sessionId) return false;
  return true;
}

/**
 * One SSE stream (spec §14). Events carry their ULID as the SSE id, so a
 * reconnect with Last-Event-ID replays exactly the missed suffix from the
 * session transcript (ULIDs are time-ordered) before going live — each
 * event id is delivered exactly once per connection.
 */
export function registerEventRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/v1/events', {
    schema: { description: 'Canonical event stream (SSE) with filters + backfill.', tags: ['events'] },
    handler: async (request, reply) => {
      const query = EventsQuery.parse(request.query);
      const lastEventId =
        (request.headers['last-event-id'] as string | undefined) ?? query.lastEventId;

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      reply.raw.write(': connected\n\n');
      const seen = new Set<string>();

      if (
        lastEventId !== undefined &&
        query.workspaceId !== undefined &&
        query.agentId !== undefined &&
        query.sessionId !== undefined
      ) {
        try {
          const transcript = await readFile(
            transcriptPath(ctx.home, query.workspaceId, query.agentId, query.sessionId),
            'utf8',
          );
          for (const line of transcript.split('\n')) {
            if (!line.trim()) continue;
            const parsed = AeosEventSchema.safeParse(JSON.parse(line));
            if (!parsed.success) continue;
            const event = parsed.data;
            if (event.id > lastEventId && matches(query, event) && !seen.has(event.id)) {
              seen.add(event.id);
              reply.raw.write(sse(event));
            }
          }
        } catch {
          // no transcript yet — nothing to backfill
        }
      }

      const unsubscribe = ctx.bus?.subscribe(
        {
          ...(query.typePrefix === undefined ? {} : { typePrefix: query.typePrefix }),
          ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
          ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
        },
        (event) => {
          if (seen.has(event.id)) return;
          seen.add(event.id);
          reply.raw.write(sse(event));
        },
      );

      request.raw.on('close', () => unsubscribe?.());
      // keep the reply open — fastify must not try to serialize a body
      await new Promise<void>((resolve) => request.raw.on('close', resolve));
    },
  });
}
