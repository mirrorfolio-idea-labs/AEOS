/** Harnesses AEOS can manage binaries for (the fake adapter has none). */
export type ManagedHarness = 'claude-code' | 'codex' | 'opencode';

/**
 * One pinned harness release. `integrity` is the npm registry SRI of the
 * package tarball — the manager downloads the tarball itself and refuses
 * it unless the bytes hash to exactly this value, so a compromised mirror
 * or registry cannot swap the top-level package under a pin.
 */
export interface BinaryPin {
  harness: ManagedHarness;
  version: string;
  /** npm package name. */
  package: string;
  /** Executable name exposed by the package (`node_modules/.bin/<bin>`). */
  bin: string;
  integrity: string;
}

/** Registry tarball URL for a pin (npm's stable layout). */
export function tarballUrl(pin: BinaryPin, registry = 'https://registry.npmjs.org'): string {
  const base = pin.package.split('/').at(-1) ?? pin.package;
  return `${registry}/${pin.package}/-/${base}-${pin.version}.tgz`;
}

/**
 * Pins of record (P2.M7.T1). codex/opencode match the versions the
 * recorded conformance fixtures were captured from (P2.M6, D11); claude
 * pins the release current at M7. Bump a pin by recording fresh fixtures
 * first, then updating version + integrity together.
 */
export const DEFAULT_PINS: readonly BinaryPin[] = [
  {
    harness: 'claude-code',
    version: '2.1.283',
    package: '@anthropic-ai/claude-code',
    bin: 'claude',
    integrity:
      'sha512-/8Y1pe7M15qMOU7RwUEjpFcM8XGVXNzWrWRXXp/0HlGm1k8FcOCxYMA9VR237JUUzzx5DkcQaGvELAo4si7TwA==',
  },
  {
    harness: 'codex',
    version: '0.149.1',
    package: '@openai/codex',
    bin: 'codex',
    integrity:
      'sha512-6q5pbcpFbJbqOpkubSDBwXmktQ55aD8eUzGzBF1zASob2DjwhBKDSNGtdZKalfrNJUdTDTPDMmzCXEXs5tMBYA==',
  },
  {
    harness: 'opencode',
    version: '1.18.23',
    package: 'opencode-ai',
    bin: 'opencode',
    integrity:
      'sha512-3NkT0XINL7d0HYkTyGV1SPChHXhvRgKqNaTgKRTGb0TXUWszXA7MW/y3zMZw29y1AQuUDAzRvVYmQ9KGRQhroA==',
  },
];

/** Default executable name per harness — what PATH fallback looks up. */
export const HARNESS_BIN: Readonly<Record<ManagedHarness, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
};
