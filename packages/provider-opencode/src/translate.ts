import { AeosEventSchema, newEventId, type AeosEvent } from '@aeos/contracts';
import { z } from 'zod';

/**
 * Translator for `opencode run --format json` event lines (the same shapes
 * OpenCode's SSE `/event` bus emits). Stateful only for session-id/cost
 * capture and the skipped counter; ids/clock injectable for byte-stable
 * goldens — the same pattern as provider-claude.
 */
export interface TranslateOptions {
  sessionId: string;
  profileId: string;
  newId?: () => string;
  now?: () => string;
}

const TextPart = z
  .object({ sessionID: z.string(), type: z.literal('text'), text: z.string() })
  .passthrough();

const ToolPart = z
  .object({
    sessionID: z.string(),
    type: z.literal('tool'),
    callID: z.string(),
    tool: z.string(),
    state: z
      .object({
        status: z.string(),
        input: z.unknown().optional(),
        output: z.string().optional(),
        error: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const PartUpdatedLine = z
  .object({
    type: z.literal('message.part.updated'),
    properties: z.object({ part: z.unknown() }).passthrough(),
  })
  .passthrough();

const MessageUpdatedLine = z
  .object({
    type: z.literal('message.updated'),
    properties: z
      .object({
        info: z
          .object({
            sessionID: z.string(),
            role: z.string(),
            cost: z.number().nonnegative().optional(),
            tokens: z
              .object({
                input: z.number().int().nonnegative().optional(),
                output: z.number().int().nonnegative().optional(),
                cache: z
                  .object({ read: z.number().int().nonnegative().optional() })
                  .passthrough()
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const SessionIdleLine = z
  .object({
    type: z.literal('session.idle'),
    properties: z.object({ sessionID: z.string() }).passthrough(),
  })
  .passthrough();

const SessionErrorLine = z
  .object({
    type: z.literal('session.error'),
    properties: z
      .object({
        sessionID: z.string().optional(),
        error: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

function errorReason(error: unknown): string {
  const named = z.object({ name: z.string() }).passthrough().safeParse(error);
  const withMessage = z
    .object({ data: z.object({ message: z.string() }).passthrough() })
    .passthrough()
    .safeParse(error);
  if (withMessage.success) return withMessage.data.data.message;
  if (named.success) return named.data.name;
  return typeof error === 'string' ? error : 'session error';
}

export class OpencodeStreamTranslator {
  providerSessionId: string | undefined;
  costUsd: number | undefined;
  skippedLines = 0;
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(private readonly opts: TranslateOptions) {
    this.newId = opts.newId ?? newEventId;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private event(type: string, payload: unknown): AeosEvent {
    return AeosEventSchema.parse({
      v: 1,
      id: this.newId(),
      ts: this.now(),
      source: 'provider-opencode',
      sessionId: this.opts.sessionId,
      type,
      payload,
    });
  }

  /** First sight of the provider session id opens the canonical session. */
  private opened(providerSessionId: string): AeosEvent[] {
    if (this.providerSessionId !== undefined) return [];
    this.providerSessionId = providerSessionId;
    return [this.event('session.created', {})];
  }

  translateLine(raw: unknown): AeosEvent[] {
    const part = PartUpdatedLine.safeParse(raw);
    if (part.success) {
      const text = TextPart.safeParse(part.data.properties.part);
      if (text.success) {
        return [
          ...this.opened(text.data.sessionID),
          this.event('item.message', { role: 'assistant', text: text.data.text }),
        ];
      }
      const tool = ToolPart.safeParse(part.data.properties.part);
      if (tool.success) {
        const events = this.opened(tool.data.sessionID);
        const state = tool.data.state;
        // Only terminal tool states translate — running/pending updates are
        // stream noise the canonical taxonomy doesn't model.
        if (state.status === 'completed' || state.status === 'error') {
          events.push(
            this.event('item.tool_call', {
              callId: tool.data.callID,
              tool: tool.data.tool,
              input: state.input ?? {},
            }),
            this.event('item.tool_result', {
              callId: tool.data.callID,
              ok: state.status === 'completed',
              output: state.output ?? state.error ?? '',
            }),
          );
        }
        return events;
      }
      this.skippedLines += 1;
      return [];
    }

    const message = MessageUpdatedLine.safeParse(raw);
    if (message.success) {
      const info = message.data.properties.info;
      const events = this.opened(info.sessionID);
      if (info.role === 'assistant' && info.cost !== undefined) {
        this.costUsd = (this.costUsd ?? 0) + info.cost;
        events.push(
          this.event('cost.usage', {
            profileId: this.opts.profileId,
            usd: info.cost,
            inputTokens: info.tokens?.input ?? 0,
            outputTokens: info.tokens?.output ?? 0,
            ...(info.tokens?.cache?.read === undefined
              ? {}
              : { cacheReadTokens: info.tokens.cache.read }),
          }),
        );
      }
      return events;
    }

    const idle = SessionIdleLine.safeParse(raw);
    if (idle.success) {
      return [...this.opened(idle.data.properties.sessionID), this.event('session.completed', {})];
    }

    const error = SessionErrorLine.safeParse(raw);
    if (error.success) {
      const sid = error.data.properties.sessionID;
      return [
        ...(sid === undefined ? [] : this.opened(sid)),
        this.event('session.failed', { reason: errorReason(error.data.properties.error) }),
      ];
    }

    this.skippedLines += 1;
    return [];
  }

  translateStream(ndjson: string): AeosEvent[] {
    const events: AeosEvent[] = [];
    for (const rawLine of ndjson.split('\n')) {
      const trimmed = rawLine.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        this.skippedLines += 1;
        continue;
      }
      events.push(...this.translateLine(parsed));
    }
    return events;
  }
}
