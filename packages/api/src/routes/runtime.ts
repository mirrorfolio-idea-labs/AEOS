import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AgentStatusSchema, type AgentStatus } from '@aeos/contracts';
import { agentDir, getAgent, listAgents, listWorkspaces, writeFileAtomic } from '@aeos/kernel';
import { ok } from '../envelope.js';
import type { ApiContext } from '../server.js';
import { statusTrackerFor, type AgentRef, type AgentStatusEntry } from '../status.js';

const WorkspaceQuery = z.object({ workspaceId: z.string().min(1) });

const WaitQuery = WorkspaceQuery.extend({
  until: z
    .string()
    .default('blocked,done')
    .transform((raw) => raw.split(',').map((s) => AgentStatusSchema.parse(s.trim()))),
  timeoutMs: z.coerce.number().int().positive().max(600_000).default(30_000),
  afterSeq: z.coerce.number().int().nonnegative().optional(),
});

const AttentionBody = z.object({ action: z.enum(['seen', 'unread', 'settle', 'unsettle']) });

/** `<agent>/attention.json` — per-agent triage state (herdr-agent-inbox idea, MIT). */
interface Attention {
  seenSeq: number;
  unread?: boolean;
  /** Settled up to this status seq — new activity un-settles automatically. */
  settledSeq?: number;
}

const attentionFile = (home: string, ref: AgentRef): string =>
  path.join(agentDir(home, ref.workspaceId, ref.id), 'attention.json');

function readAttention(home: string, ref: AgentRef): Attention {
  try {
    return JSON.parse(fs.readFileSync(attentionFile(home, ref), 'utf8')) as Attention;
  } catch {
    return { seenSeq: 0 };
  }
}

export interface InboxItem extends AgentStatusEntry {
  name: string;
  unseen: boolean;
  settled: boolean;
  /** 0 blocked · 1 finished-unseen · 2 working · 3 idle/seen · 4 settled. */
  bucket: number;
}

const NEEDS_EYES: readonly AgentStatus[] = ['blocked', 'done'];

export function inboxItem(entry: AgentStatusEntry, attention: Attention, name: string): InboxItem {
  const unseen = attention.unread === true || (NEEDS_EYES.includes(entry.status) && entry.seq > attention.seenSeq);
  const settled = attention.settledSeq !== undefined && entry.seq <= attention.settledSeq;
  const bucket = settled
    ? 4
    : entry.status === 'blocked'
      ? 0
      : entry.status === 'done' && unseen
        ? 1
        : entry.status === 'working'
          ? 2
          : 3;
  return { ...entry, name, unseen, settled, bucket };
}

/** Attention order: bucket, then most recent change first. */
export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => a.bucket - b.bucket || b.since.localeCompare(a.since));
}

/**
 * Agent runtime routes (P2.M10, ideas from herdr + herdr-agent-inbox):
 * status, a race-free wait-until primitive, and an attention-sorted inbox
 * with seen / unread / settle triage.
 */
export function registerRuntimeRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const tracker = (): ReturnType<typeof statusTrackerFor> => statusTrackerFor(ctx.home, ctx.bus);

  app.get<{ Params: { id: string } }>('/v1/agents/:id/status', {
    schema: { description: 'Current attention status of one agent (idle | working | blocked | done | unknown).', tags: ['runtime'] },
    handler: (request) => {
      const { workspaceId } = WorkspaceQuery.parse(request.query);
      getAgent(ctx.home, workspaceId, request.params.id);
      return ok(tracker().get({ workspaceId, id: request.params.id }));
    },
  });

  app.get<{ Params: { id: string } }>('/v1/agents/:id/wait', {
    schema: {
      description:
        'Long-poll until the agent reaches one of `until` (default blocked,done). Pass `afterSeq` (from a prior status read) to require a NEW transition — race-free act-then-wait.',
      tags: ['runtime'],
    },
    handler: async (request) => {
      const { workspaceId, until, timeoutMs, afterSeq } = WaitQuery.parse(request.query);
      getAgent(ctx.home, workspaceId, request.params.id);
      const ref = { workspaceId, id: request.params.id };
      const controller = new AbortController();
      request.raw.on('close', () => controller.abort());
      const entry = await tracker().waitFor(ref, {
        until,
        timeoutMs,
        signal: controller.signal,
        ...(afterSeq === undefined ? {} : { afterSeq }),
      });
      return ok({ matched: entry !== undefined, entry: entry ?? tracker().get(ref) });
    },
  });

  app.get('/v1/inbox', {
    schema: {
      description: 'Every agent, attention-sorted: blocked → finished-unseen → working → idle → settled.',
      tags: ['runtime'],
    },
    handler: () => {
      const items: InboxItem[] = [];
      for (const workspace of listWorkspaces(ctx.home)) {
        for (const agent of listAgents(ctx.home, workspace.id)) {
          const ref = { workspaceId: workspace.id, id: agent.id };
          items.push(inboxItem(tracker().get(ref), readAttention(ctx.home, ref), agent.name));
        }
      }
      return ok(sortInbox(items));
    },
  });

  app.post<{ Params: { id: string } }>('/v1/agents/:id/attention', {
    schema: {
      description: 'Triage: seen (clear unseen), unread (force unseen), settle (sink until new activity), unsettle.',
      tags: ['runtime'],
    },
    handler: (request) => {
      const { workspaceId } = WorkspaceQuery.parse(request.query);
      const { action } = AttentionBody.parse(request.body);
      const agent = getAgent(ctx.home, workspaceId, request.params.id);
      const ref = { workspaceId, id: agent.id };
      const entry = tracker().get(ref);
      const current = readAttention(ctx.home, ref);
      const next: Attention =
        action === 'seen'
          ? { ...current, seenSeq: entry.seq, unread: false }
          : action === 'unread'
            ? { ...current, unread: true }
            : action === 'settle'
              ? { ...current, seenSeq: entry.seq, unread: false, settledSeq: entry.seq }
              : { seenSeq: current.seenSeq, ...(current.unread === undefined ? {} : { unread: current.unread }) };
      writeFileAtomic(attentionFile(ctx.home, ref), JSON.stringify(next, null, 2) + '\n');
      return ok(inboxItem(entry, next, agent.name));
    },
  });
}
