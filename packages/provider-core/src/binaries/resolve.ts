import { execFileSync } from 'node:child_process';
import type { BinaryManager } from './manager.js';
import { HARNESS_BIN, type ManagedHarness } from './pins.js';
import { extractVersion } from './versions.js';

/** What an agent's config says about its harness binary. */
export interface HarnessBinarySpec {
  harness: ManagedHarness;
  /** Pinned version — managed install only, never a PATH fallback. */
  version?: string | undefined;
  /** Bring-your-own executable (used when no version is pinned). */
  binaryPath?: string | undefined;
}

export type HarnessBinarySource = 'managed' | 'byo' | 'path';

export interface ResolvedHarness {
  /** argv prefix to exec (`[executable]`). */
  command: string[];
  /** Known version — `undefined` when a BYO/PATH binary would not say. */
  version: string | undefined;
  source: HarnessBinarySource;
}

export interface ResolveDeps {
  manager?: BinaryManager;
  /** `<cmd> --version` probe seam; default execs with a 5 s timeout. */
  probeVersion?: (command: string) => string | undefined;
}

const defaultProbe = (command: string): string | undefined => {
  try {
    return extractVersion(
      execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  } catch {
    return undefined;
  }
};

/**
 * Binary precedence (P2.M7): a pinned `version` resolves ONLY to the
 * verified managed install (tamper/not-installed errors propagate — a pin
 * never silently degrades to whatever is on PATH); otherwise an explicit
 * BYO `binaryPath`; otherwise the harness's default name on PATH. BYO and
 * PATH binaries are version-probed so capability gates still apply.
 */
export function resolveHarnessCommand(spec: HarnessBinarySpec, deps: ResolveDeps = {}): ResolvedHarness {
  const probe = deps.probeVersion ?? defaultProbe;
  if (spec.version !== undefined) {
    if (deps.manager === undefined) {
      throw new Error(`${spec.harness}@${spec.version} is pinned but no binary manager is configured`);
    }
    const binary = deps.manager.verify(spec.harness, spec.version);
    return { command: [binary.executable], version: binary.version, source: 'managed' };
  }
  if (spec.binaryPath !== undefined) {
    return { command: [spec.binaryPath], version: probe(spec.binaryPath), source: 'byo' };
  }
  const name = HARNESS_BIN[spec.harness];
  return { command: [name], version: probe(name), source: 'path' };
}
