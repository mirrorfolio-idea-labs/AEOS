import type { AeosEvent, AgentConfig } from '@aeos/contracts';

/** What a harness can and cannot do (spec §9). Asserted by conformance, never hand-maintained docs. */
export interface CapabilityMatrix {
  resume: boolean;
  structuredOutput: boolean;
  mcp: boolean;
  sandbox: boolean;
  costReporting: boolean;
  maxContextTokens?: number;
}

/**
 * A fully hermetic launch recipe for one agent: everything the runner needs
 * to spawn the harness without touching the user's global config.
 */
export interface HarnessProfile {
  /** Directory owning all harness state for this agent (e.g. `<agent>/harness/claude`). */
  rootDir: string;
  env: Readonly<Record<string, string>>;
  argv: readonly string[];
}

export interface SpawnOptions {
  profile: HarnessProfile;
  /** AEOS session ULID — stamped onto every emitted event's `sessionId`. */
  sessionId: string;
  objective: string;
  /** Provider-native resume token from a previous session (capability `resume`). */
  resumeToken?: string;
}

/**
 * A live (or replayed) harness session. `providerSessionId`, `resumeToken`
 * and `costUsd` are populated as the stream is consumed — read them after
 * (or while) iterating `events`.
 */
export interface SessionHandle {
  events: AsyncIterable<AeosEvent>;
  readonly providerSessionId: string | undefined;
  readonly resumeToken: string | undefined;
  readonly costUsd: number | undefined;
  /** Terminate the underlying process/replay; the event stream ends promptly. */
  kill(): void;
}

/**
 * The provider contract (spec §9). One implementation per harness
 * (claude-code, codex, opencode, fake). `translate` must be pure and total:
 * same input → same output, unknown input → `[]`, never a throw.
 */
export interface HarnessAdapter {
  readonly id: string;
  capabilities(): CapabilityMatrix;
  createProfile(agent: AgentConfig): Promise<HarnessProfile>;
  spawn(opts: SpawnOptions): SessionHandle;
  translate(raw: unknown): AeosEvent[];
}
