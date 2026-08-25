import { AeosEventSchema, newEventId, type AeosEvent } from '@aeos/contracts';
import { z } from 'zod';

/**
 * Translator for `codex exec --json` NDJSON lines (codex-cli 0.149.1
 * shapes, recorded in test/fixtures). Line types: `thread.started`,
 * `turn.started`, `item.completed` (item types: `agent_message`,
 * `command_execution`, `reasoning`, …), `turn.completed{usage}`.
 *
 * Stateful only for thread-id capture and turn numbering; ids/clock
 * injectable for byte-stable goldens — the same pattern as the Claude and
 * OpenCode translators. Unknown LINE types are skipped (counted); unknown
 * ITEM types fall through to a system message additively (D11 discipline).
 */
export interface TranslateOptions {
  sessionId: string;
  profileId: string;
  newId?: () => string;
  now?: () => string;
}

const AgentMessageItem = z
  .object({ id: z.string(), type: z.literal('agent_message'), text: z.string() })
  .passthrough();

const ReasoningItem = z
  .object({ id: z.string(), type: z.literal('reasoning'), text: z.string() })
  .passthrough();

const CommandExecutionItem = z
  .object({
    id: z.string(),
    type: z.literal('command_execution'),
    command: z.string(),
    aggregated_output: z.string().optional(),
    exit_code: z.number().int(),
    status: z.string(),
  })
  .passthrough();

const ThreadStartedLine = z
  .object({ type: z.literal('thread.started'), thread_id: z.string().min(1) })
  .passthrough();

const TurnStartedLine = z.object({ type: z.literal('turn.started') }).passthrough();

const ItemCompletedLine = z
  .object({ type: z.literal('item.completed'), item: z.unknown() })
  .passthrough();

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  cached_input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
});

const TurnCompletedLine = z
  .object({ type: z.literal('turn.completed'), usage: UsageSchema.passthrough() })
  .passthrough();

export class CodexStreamTranslator {
  /** Codex thread id — captured from thread.started, used as resume token. */
  providerSessionId: string | undefined;
  /** Token-only fidelity: codex reports tokens, never USD (see matrix). */
  costUsd: number | undefined;
  skippedLines = 0;

  constructor(private readonly opts: TranslateOptions) {}

  private event(partial: Omit<AeosEvent, 'v' | 'id' | 'ts' | 'source' | 'sessionId'>): AeosEvent {
    return AeosEventSchema.parse({
      v: 1,
      id: (this.opts.newId ?? newEventId)(),
      ts: (this.opts.now ?? (() => new Date().toISOString()))(),
      source: 'codex',
      sessionId: this.opts.sessionId,
      ...partial,
    });
  }

  /** Clean process exit — codex has no idle line, so the handle calls this. */
  sessionEnd(): AeosEvent[] {
    if (this.providerSessionId === undefined) return [];
    return [this.event({ type: 'session.completed', payload: {} })];
  }

  translateLine(raw: unknown): AeosEvent[] {
    if (typeof raw !== 'object' || raw === null) {
      this.skippedLines += 1;
      return [];
    }
    const line = raw as { type?: unknown };

    if (ThreadStartedLine.safeParse(raw).success) {
      const parsed = ThreadStartedLine.parse(raw);
      if (this.providerSessionId !== undefined) return []; // resumed runs re-announce
      this.providerSessionId = parsed.thread_id;
      return [this.event({ type: 'session.created', payload: {} })];
    }

    if (TurnStartedLine.safeParse(raw).success) {
      // canonical turn.* carries a mandatory positive turn number that is
      // meaningless per-line (conformance requires fresh-translator purity);
      // turn boundaries surface via cost.usage rows instead — same as OpenCode
      return [];
    }

    if (TurnCompletedLine.safeParse(raw).success) {
      const parsed = TurnCompletedLine.parse(raw);
      return [
        this.event({
          type: 'cost.usage',
          payload: {
            profileId: this.opts.profileId,
            usd: 0, // codex reports tokens only — USD stays unset rather than fabricated
            inputTokens: parsed.usage.input_tokens,
            outputTokens: parsed.usage.output_tokens,
            ...(parsed.usage.cached_input_tokens > 0
              ? { cacheReadTokens: parsed.usage.cached_input_tokens }
              : {}),
          },
        }),
      ];
    }

    if (ItemCompletedLine.safeParse(raw).success) {
      const item = ItemCompletedLine.parse(raw).item as Record<string, unknown>;
      return this.translateItem(item);
    }

    this.skippedLines += 1;
    return [];
  }

  private translateItem(item: Record<string, unknown>): AeosEvent[] {
    if (AgentMessageItem.safeParse(item).success) {
      const parsed = AgentMessageItem.parse(item);
      return [this.event({ type: 'item.message', payload: { role: 'assistant', text: parsed.text } })];
    }
    if (ReasoningItem.safeParse(item).success) {
      const parsed = ReasoningItem.parse(item);
      return [this.event({ type: 'item.message', payload: { role: 'system', text: parsed.text } })];
    }
    if (CommandExecutionItem.safeParse(item).success) {
      const parsed = CommandExecutionItem.parse(item);
      return [
        this.event({
          type: 'item.tool_call',
          payload: { callId: parsed.id, tool: 'shell', input: { command: parsed.command } },
        }),
        this.event({
          type: 'item.tool_result',
          payload: {
            callId: parsed.id,
            ok: parsed.exit_code === 0,
            output: parsed.aggregated_output ?? '',
          },
        }),
      ];
    }
    // unknown item type — surface it as system text instead of dropping it
    const text = JSON.stringify(item);
    return [this.event({ type: 'item.message', payload: { role: 'system', text } })];
  }
}
