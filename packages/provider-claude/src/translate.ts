import { AeosEventSchema, newEventId, type AeosEvent } from '@aeos/contracts';
import { z } from 'zod';

/**
 * Translator for `claude -p --output-format stream-json --verbose` NDJSON.
 * Stateful only for provider-session-id capture and the skipped-line
 * counter; the event mapping itself is deterministic given (line, context),
 * with id/clock injectable so golden tests are byte-stable.
 */
export interface TranslateOptions {
  /** AEOS session ULID stamped on every event. */
  sessionId: string;
  /** Credential profile id tagged onto cost.usage (spec §9 BYOK). */
  profileId: string;
  newId?: () => string;
  now?: () => string;
}

const ContentBlock = z.union([
  z.object({ type: z.literal('text'), text: z.string() }).passthrough(),
  z
    .object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() })
    .passthrough(),
  z
    .object({
      type: z.literal('tool_result'),
      tool_use_id: z.string(),
      content: z.unknown(),
      is_error: z.boolean().optional(),
    })
    .passthrough(),
]);

const SystemInitLine = z
  .object({ type: z.literal('system'), subtype: z.literal('init'), session_id: z.string() })
  .passthrough();

const MessageLine = z
  .object({
    type: z.enum(['assistant', 'user']),
    message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }).passthrough(),
  })
  .passthrough();

const ResultLine = z
  .object({
    type: z.literal('result'),
    subtype: z.string(),
    is_error: z.boolean(),
    session_id: z.string(),
    total_cost_usd: z.number().nonnegative().optional(),
    result: z.string().optional(),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative().optional(),
        output_tokens: z.number().int().nonnegative().optional(),
        cache_read_input_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function toolResultOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const parsed = z.object({ type: z.literal('text'), text: z.string() }).safeParse(block);
        return parsed.success ? parsed.data.text : '';
      })
      .join('');
  }
  return '';
}

export class ClaudeStreamTranslator {
  providerSessionId: string | undefined;
  costUsd: number | undefined;
  skippedLines = 0;
  /** Set by the final `result` line: true → session.completed, false → session.failed. */
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(private readonly opts: TranslateOptions) {
    this.newId = opts.newId ?? newEventId;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private envelope() {
    return {
      v: 1 as const,
      id: this.newId(),
      ts: this.now(),
      source: 'provider-claude',
      sessionId: this.opts.sessionId,
    };
  }

  private event(type: string, payload: unknown): AeosEvent {
    return AeosEventSchema.parse({ ...this.envelope(), type, payload });
  }

  /** Translate one parsed NDJSON line. Unknown shapes are counted, never thrown. */
  translateLine(raw: unknown): AeosEvent[] {
    const sys = SystemInitLine.safeParse(raw);
    if (sys.success) {
      this.providerSessionId = sys.data.session_id;
      return [this.event('session.created', {})];
    }

    const msg = MessageLine.safeParse(raw);
    if (msg.success) {
      const role = msg.data.type;
      const content = msg.data.message.content;
      if (typeof content === 'string') {
        return content.length === 0 ? [] : [this.event('item.message', { role, text: content })];
      }
      const events: AeosEvent[] = [];
      for (const rawBlock of content) {
        const block = ContentBlock.safeParse(rawBlock);
        if (!block.success) {
          this.skippedLines += 1;
          continue;
        }
        const b = block.data;
        if (b.type === 'text') {
          events.push(this.event('item.message', { role, text: b.text }));
        } else if (b.type === 'tool_use') {
          events.push(this.event('item.tool_call', { callId: b.id, tool: b.name, input: b.input }));
        } else {
          events.push(
            this.event('item.tool_result', {
              callId: b.tool_use_id,
              ok: b.is_error !== true,
              output: toolResultOutput(b.content),
            }),
          );
        }
      }
      return events;
    }

    const res = ResultLine.safeParse(raw);
    if (res.success) {
      // result line: cost first, then terminal state (spec §9 ordering).
      const data = res.data;
      this.providerSessionId = data.session_id;
      const events: AeosEvent[] = [];
      if (data.total_cost_usd !== undefined) {
        this.costUsd = (this.costUsd ?? 0) + data.total_cost_usd;
        events.push(
          this.event('cost.usage', {
            profileId: this.opts.profileId,
            usd: data.total_cost_usd,
            inputTokens: data.usage?.input_tokens ?? 0,
            outputTokens: data.usage?.output_tokens ?? 0,
            ...(data.usage?.cache_read_input_tokens === undefined
              ? {}
              : { cacheReadTokens: data.usage.cache_read_input_tokens }),
          }),
        );
      }
      events.push(
        data.is_error
          ? this.event('session.failed', { reason: data.result ?? data.subtype })
          : this.event('session.completed', {}),
      );
      return events;
    }

    this.skippedLines += 1;
    return [];
  }

  /** Translate a full NDJSON document (fixture files, buffered output). */
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
