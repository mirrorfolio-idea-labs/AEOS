/**
 * Minimal dotted-version comparison for harness CLIs (`2.1.283`,
 * `0.149.1`, `1.18.23-beta.1`). Pre-release tags sort before the release,
 * matching semver precedence closely enough for capability gating; no
 * range syntax — gates are plain minimums.
 */
export function parseVersion(raw: string): { parts: number[]; pre: string | undefined } | undefined {
  const match = /(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/.exec(raw.trim());
  if (match === null || match[1] === undefined) return undefined;
  return { parts: match[1].split('.').map(Number), pre: match[2] };
}

/** Negative when `a < b`, zero when equal, positive when `a > b`. Throws on unparseable input. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === undefined || pb === undefined) {
    throw new Error(`unparseable version: ${pa === undefined ? a : b}`);
  }
  const length = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === undefined) return 1;
  if (pb.pre === undefined) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** Pull the first version-looking token out of `<cli> --version` output. */
export function extractVersion(output: string): string | undefined {
  const match = /\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?/.exec(output);
  return match?.[0];
}
