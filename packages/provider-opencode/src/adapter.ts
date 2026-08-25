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
import { buildOpencodeProfile, type SecretResolver } from './profile.js';
import { OpencodeStreamTranslator } from './translate.js';

const GOLDEN_TS = '2026-01-01T00:00:00.000Z';
const goldenId = (n: number): string => String(n).padStart(26, '0');

/** Child seam — identical contract to provider-claude's RunChild. */
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

export interface OpencodeAdapterOptions {
  agentDir: (agent: AgentConfig) => string;
  credential: (agent: AgentConfig) => CredentialProfile;
  secrets: SecretResolver;
  /** Slot → persistent data home for subscription accounts (see profile.ts). */
  subscriptionHomeFor?: (slot: string) => string;
  runChild?: RunChild;
}

class OpencodeSessionHandle implements SessionHandle {
  readonly events: AsyncIterable<AeosEvent>;
  private readonly abort = new AbortController();

  constructor(
    private readonly translator: OpencodeStreamTranslator,
    runChild: RunChild,
    opts: SpawnOptions,
    argv: readonly string[],
  ) {
    const { signal } = this.abort;
    const stream = async function* (this: OpencodeSessionHandle): AsyncGenerator<AeosEvent> {
      try {
        for await (const line of runChild(opts.profile, argv, signal)) {
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
        if (signal.aborted) return;
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

/** OpenCode provider (spec §9, P1.M10): XDG-hermetic profile + event translation. */
export class OpencodeAdapter implements HarnessAdapter {
  readonly id = 'opencode';
  private readonly runChild: RunChild;

  constructor(private readonly opts: OpencodeAdapterOptions) {
    this.runChild = opts.runChild ?? defaultRunChild;
  }

  capabilities(): CapabilityMatrix {
    return {
      resume: true,
      structuredOutput: true,
      mcp: true,
      sandbox: false,
      costReporting: true,
      costUsd: true,
    };
  }

  createProfile(agent: AgentConfig): Promise<HarnessProfile> {
    return buildOpencodeProfile({
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
      'opencode',
      'run',
      opts.objective,
      '--format',
      'json',
      ...opts.profile.argv,
      ...(opts.resumeToken === undefined ? [] : ['--session', opts.resumeToken]),
    ];
  }

  spawn(opts: SpawnOptions): SessionHandle {
    const translator = new OpencodeStreamTranslator({
      sessionId: opts.sessionId,
      profileId: opts.profile.env['AEOS_CREDENTIAL_PROFILE_ID'] ?? 'unknown',
    });
    return new OpencodeSessionHandle(translator, this.runChild, opts, this.buildArgv(opts));
  }

  /** Pure fixture translation — deterministic ids, same contract as ClaudeAdapter. */
  translate(raw: unknown): AeosEvent[] {
    let counter = 0;
    const translator = new OpencodeStreamTranslator({
      sessionId: 'translate',
      profileId: 'translate',
      newId: () => goldenId(counter++),
      now: () => GOLDEN_TS,
    });
    return translator.translateLine(raw);
  }
}
