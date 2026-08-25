import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AeosEventSchema,
  newEventId,
  type AeosEvent,
  type AgentConfig,
} from '@aeos/contracts';
import type {
  CapabilityMatrix,
  HarnessAdapter,
  HarnessProfile,
  SessionHandle,
  SpawnOptions,
} from './adapter.js';

export interface FakeScript {
  /** Canonical events to replay, in order (build with `buildFixtureEvents`). */
  events: readonly AeosEvent[];
  /** Provider-native session id "captured" when `session.created` is replayed. */
  providerSessionId: string;
  /** `complete` replays the fixture as-is; `fail` swaps the tail for `session.failed`. */
  exit?: 'complete' | 'fail';
  failureReason?: string;
  /** Delay between replayed events — lets tests exercise kill()/pacing. */
  paceMs?: number;
}

const envelope = (sessionId: string) => ({
  v: 1 as const,
  id: newEventId(),
  ts: new Date().toISOString(),
  source: 'provider-fake',
  sessionId,
});

/** A canonical single-turn session: the CI workhorse fixture (M4 plan T1.3). */
export function buildFixtureEvents(opts: { profileId: string; sessionId?: string }): AeosEvent[] {
  const sessionId = opts.sessionId ?? 'fixture-session';
  const base = () => envelope(sessionId);
  return AeosEventSchema.array().parse([
    { ...base(), type: 'session.created', payload: {} },
    { ...base(), type: 'turn.started', payload: { turn: 1 } },
    {
      ...base(),
      type: 'item.message',
      payload: { role: 'assistant', text: 'Working on the objective.' },
    },
    {
      ...base(),
      type: 'item.tool_call',
      payload: { callId: 'call-1', tool: 'bash', input: { command: 'echo hi' } },
    },
    {
      ...base(),
      type: 'item.tool_result',
      payload: { callId: 'call-1', ok: true, output: 'hi\n' },
    },
    { ...base(), type: 'turn.completed', payload: { turn: 1 } },
    {
      ...base(),
      type: 'cost.usage',
      payload: { profileId: opts.profileId, usd: 0.0042, inputTokens: 1200, outputTokens: 340 },
    },
    { ...base(), type: 'session.completed', payload: {} },
  ]);
}

class FakeSessionHandle implements SessionHandle {
  readonly events: AsyncIterable<AeosEvent>;
  providerSessionId: string | undefined;
  resumeToken: string | undefined;
  costUsd: number | undefined;
  private killed = false;

  constructor(script: FakeScript, opts: SpawnOptions) {
    this.events = this.replay(script, opts);
  }

  kill(): void {
    this.killed = true;
  }

  private async *replay(script: FakeScript, opts: SpawnOptions): AsyncGenerator<AeosEvent> {
    let sequence = [...script.events];
    if (script.exit === 'fail') {
      sequence = sequence.filter((e) => e.type !== 'session.completed');
      sequence.push(
        AeosEventSchema.parse({
          ...sequence[0],
          id: newEventId(),
          type: 'session.failed',
          payload: { reason: script.failureReason ?? 'fake failure' },
        }),
      );
    }
    for (const event of sequence) {
      if (this.killed) return;
      if (script.paceMs) await delay(script.paceMs);
      if (this.killed) return;
      if (event.type === 'session.created') {
        this.providerSessionId = script.providerSessionId;
        this.resumeToken = script.providerSessionId;
      }
      if (event.type === 'cost.usage') {
        this.costUsd = (this.costUsd ?? 0) + event.payload.usd;
      }
      yield { ...event, sessionId: opts.sessionId };
    }
  }
}

/**
 * Scripted adapter replaying a canonical-event fixture — the CI workhorse
 * for conformance, scheduler (M6) and golden-path (M9) tests. No child
 * process, no network, fully deterministic apart from event ids/timestamps.
 */
export class FakeAdapter implements HarnessAdapter {
  readonly id = 'fake';

  constructor(private readonly script: FakeScript) {}

  capabilities(): CapabilityMatrix {
    return {
      resume: true,
      structuredOutput: true,
      mcp: false,
      sandbox: false,
      costReporting: true,
      costUsd: true,
    };
  }

  createProfile(agent: AgentConfig): Promise<HarnessProfile> {
    return Promise.resolve({
      rootDir: path.join(os.tmpdir(), 'aeos-provider-fake', agent.id),
      env: { AEOS_PROVIDER_FAKE: '1' },
      argv: ['aeos-provider-fake', '--agent', agent.id],
    });
  }

  spawn(opts: SpawnOptions): SessionHandle {
    return new FakeSessionHandle(this.script, opts);
  }

  translate(raw: unknown): AeosEvent[] {
    const parsed = AeosEventSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  }
}
