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
import { buildCodexProfile, type SecretResolver } from './profile.js';
import { CodexStreamTranslator } from './translate.js';

const GOLDEN_TS = '2026-01-01T00:00:00.000Z';
const goldenId = (n: number): string => String(n).padStart(26, '0');

/** Child seam — identical contract to provider-claude's / provider-opencode's. */
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

export interface CodexAdapterOptions {
  agentDir: (agent: AgentConfig) => string;
  credential: (agent: AgentConfig) => CredentialProfile;
  secrets: SecretResolver;
  /** Slot → persistent login home for subscription accounts (see profile.ts). */
  subscriptionHomeFor?: (slot: string) => string;
  runChild?: RunChild;
}

class CodexSessionHandle implements SessionHandle {
  readonly events: AsyncIterable<AeosEvent>;
  private readonly abort = new AbortController();

  constructor(
    private readonly translator: CodexStreamTranslator,
    runChild: RunChild,
    opts: SpawnOptions,
    argv: readonly string[],
  ) {
    const { signal } = this.abort;
    const stream = async function* (this: CodexSessionHandle): AsyncGenerator<AeosEvent> {
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
        // codex has no explicit idle line — a clean process exit ends the session
        if (!signal.aborted) yield* this.translator.sessionEnd();
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

/**
 * OpenAI Codex provider (spec §9, P2.M6): CODEX_HOME-hermetic profile +
 * thread/turn/item translation. `codex exec --json` headless only; sandbox
 * selection rides the policy compiler like every other harness flag.
 */
export class CodexAdapter implements HarnessAdapter {
  readonly id = 'codex';
  private readonly runChild: RunChild;

  constructor(private readonly opts: CodexAdapterOptions) {
    this.runChild = opts.runChild ?? defaultRunChild;
  }

  capabilities(): CapabilityMatrix {
    return {
      resume: true,
      structuredOutput: true,
      mcp: false, // config.toml MCP wiring lands with feature toggles
      sandbox: true, // codex has native sandbox modes
      costReporting: true, // token fidelity only — see costUsd below
      costUsd: false, // codex reports no USD; tokens are real
    };
  }

  createProfile(agent: AgentConfig): Promise<HarnessProfile> {
    return buildCodexProfile({
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
      'codex',
      'exec',
      '--json',
      '--skip-git-repo-check',
      ...(opts.resumeToken === undefined
        ? []
        : ['resume', opts.resumeToken]),
      opts.objective,
    ];
  }

  spawn(opts: SpawnOptions): SessionHandle {
    const translator = new CodexStreamTranslator({
      sessionId: opts.sessionId,
      profileId: opts.profile.env['AEOS_CREDENTIAL_PROFILE_ID'] ?? 'unknown',
    });
    return new CodexSessionHandle(translator, this.runChild, opts, this.buildArgv(opts));
  }

  /** Pure fixture translation — deterministic ids, same contract as siblings. */
  translate(raw: unknown): AeosEvent[] {
    let counter = 0;
    const translator = new CodexStreamTranslator({
      sessionId: 'translate',
      profileId: 'translate',
      newId: () => goldenId(counter++),
      now: () => GOLDEN_TS,
    });
    return translator.translateLine(raw);
  }
}
