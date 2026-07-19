import { spawn as spawnProcess } from 'node:child_process';
import readline from 'node:readline';
import type { AeosEvent, AgentConfig, CredentialProfile } from '@aeos/contracts';
import type {
  CapabilityMatrix,
  HarnessAdapter,
  HarnessProfile,
  SessionHandle,
  SpawnOptions,
} from '@aeos/provider-core';
import { buildClaudeProfile, type SecretResolver } from './profile.js';
import { ClaudeStreamTranslator } from './translate.js';

/** Fixed timestamp + counter ids make `translate()` a pure function of its input. */
const GOLDEN_TS = '2026-01-01T00:00:00.000Z';
const goldenId = (n: number): string => String(n).padStart(26, '0');

/**
 * Child seam (M4 plan T3.2): the runner owns the OS process; the adapter
 * owns argv/env and translation. Tests and the runner integration inject
 * their own line source; the default spawns `claude` directly.
 */
export type RunChild = (
  profile: HarnessProfile,
  argv: readonly string[],
  signal: AbortSignal,
) => AsyncIterable<string>;

const defaultRunChild: RunChild = async function* (profile, argv, signal) {
  const [command, ...rest] = argv;
  if (!command) throw new Error('empty argv');
  const child = spawnProcess(command, rest, {
    cwd: profile.rootDir,
    env: { PATH: process.env['PATH'] ?? '', ...profile.env },
    stdio: ['ignore', 'pipe', 'ignore'],
    signal,
  });
  const lines = readline.createInterface({ input: child.stdout });
  try {
    for await (const line of lines) yield line;
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
};

export interface ClaudeAdapterOptions {
  /** Where an agent's files live — profile state goes under `<dir>/harness/claude`. */
  agentDir: (agent: AgentConfig) => string;
  credential: (agent: AgentConfig) => CredentialProfile;
  secrets: SecretResolver;
  /** Slot → persistent login home for subscription accounts (see profile.ts). */
  subscriptionHomeFor?: (slot: string) => string;
  runChild?: RunChild;
}

class ClaudeSessionHandle implements SessionHandle {
  readonly events: AsyncIterable<AeosEvent>;
  private readonly abort = new AbortController();

  constructor(
    private readonly translator: ClaudeStreamTranslator,
    runChild: RunChild,
    opts: SpawnOptions,
    argv: readonly string[],
  ) {
    const { signal } = this.abort;
    const stream = async function* (this: ClaudeSessionHandle): AsyncGenerator<AeosEvent> {
      let lines: AsyncIterable<string>;
      try {
        lines = runChild(opts.profile, argv, signal);
        for await (const line of lines) {
          if (signal.aborted) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            this.translator.skippedLines += 1;
            continue;
          }
          yield* this.translator.translateLine(parsed);
        }
      } catch (error: unknown) {
        if (signal.aborted) return; // kill() — a killed session just ends.
        throw error;
      }
    }.call(this);
    this.events = stream;
  }

  get providerSessionId(): string | undefined {
    return this.translator.providerSessionId;
  }

  get resumeToken(): string | undefined {
    return this.translator.providerSessionId;
  }

  get costUsd(): number | undefined {
    return this.translator.costUsd;
  }

  kill(): void {
    this.abort.abort();
  }
}

/** Claude Code provider (spec §9): hermetic profile + stream-json translation. */
export class ClaudeAdapter implements HarnessAdapter {
  readonly id = 'claude-code';
  private readonly runChild: RunChild;

  constructor(private readonly opts: ClaudeAdapterOptions) {
    this.runChild = opts.runChild ?? defaultRunChild;
  }

  capabilities(): CapabilityMatrix {
    return {
      resume: true,
      structuredOutput: true,
      mcp: true,
      sandbox: true,
      costReporting: true,
    };
  }

  createProfile(agent: AgentConfig): Promise<HarnessProfile> {
    return buildClaudeProfile({
      agent,
      agentDir: this.opts.agentDir(agent),
      credential: this.opts.credential(agent),
      secrets: this.opts.secrets,
      ...(this.opts.subscriptionHomeFor === undefined
        ? {}
        : { subscriptionHomeFor: this.opts.subscriptionHomeFor }),
    });
  }

  buildArgv(opts: SpawnOptions): string[] {
    return [
      'claude',
      '-p',
      opts.objective,
      '--output-format',
      'stream-json',
      '--verbose',
      ...opts.profile.argv,
      ...(opts.resumeToken === undefined ? [] : ['--resume', opts.resumeToken]),
    ];
  }

  spawn(opts: SpawnOptions): SessionHandle {
    const translator = new ClaudeStreamTranslator({
      sessionId: opts.sessionId,
      profileId: opts.profile.env['AEOS_CREDENTIAL_PROFILE_ID'] ?? 'unknown',
    });
    return new ClaudeSessionHandle(translator, this.runChild, opts, this.buildArgv(opts));
  }

  /**
   * Pure fixture translation: deterministic ids/timestamps derived only from
   * the input, so identical raw lines always yield identical events. The
   * live streaming path (spawn) mints real ULIDs instead.
   */
  translate(raw: unknown): AeosEvent[] {
    let counter = 0;
    const translator = new ClaudeStreamTranslator({
      sessionId: 'translate',
      profileId: 'translate',
      newId: () => goldenId(counter++),
      now: () => GOLDEN_TS,
    });
    return translator.translateLine(raw);
  }
}
