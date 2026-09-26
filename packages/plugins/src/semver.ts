/**
 * Minimal semver range matching for the plugin contract gate (P4.M2) — just
 * the forms plugin manifests use: `*`, exact `1.2.3`, `^1`, `^1.2`,
 * `^1.2.3`, `~1.2`, `~1.2.3`, comparators `>=1.0.0`, `<2`, and
 * space-separated conjunctions (`>=1.0.0 <2`). Anything else is rejected as
 * unparseable rather than guessed at.
 */

type Version = [number, number, number];

function parseVersion(text: string): { v: Version; parts: number } | undefined {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim());
  if (m === null) return undefined;
  const parts = m.slice(1).filter((p) => p !== undefined).length;
  return { v: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], parts };
}

const cmp = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function comparator(token: string): ((v: Version) => boolean) | undefined {
  if (token === '*' || token === 'x') return () => true;
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token);
  if (m === null) return undefined;
  const op = m[1] ?? '=';
  const parsed = parseVersion(m[2] as string);
  if (parsed === undefined) return undefined;
  const { v: base, parts } = parsed;
  switch (op) {
    case '^': {
      // ^0.x pins the minor (npm semantics); ^X pins the major
      const upper: Version = base[0] > 0 || parts === 1 ? [base[0] + 1, 0, 0] : [0, base[1] + 1, 0];
      return (v) => cmp(v, base) >= 0 && cmp(v, upper) < 0;
    }
    case '~': {
      const upper: Version = parts === 1 ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
      return (v) => cmp(v, base) >= 0 && cmp(v, upper) < 0;
    }
    case '>=':
      return (v) => cmp(v, base) >= 0;
    case '<=':
      return (v) => cmp(v, base) <= 0;
    case '>':
      return (v) => cmp(v, base) > 0;
    case '<':
      return (v) => cmp(v, base) < 0;
    default: {
      // a partial exact version (`1`, `1.2`) matches that whole line
      if (parts === 3) return (v) => cmp(v, base) === 0;
      const upper: Version = parts === 1 ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
      return (v) => cmp(v, base) >= 0 && cmp(v, upper) < 0;
    }
  }
}

/** Does `version` satisfy `range`? Throws on an unparseable range or version. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (v === undefined || v.parts !== 3) throw new Error(`not a semver version: "${version}"`);
  const tokens = range.trim().split(/\s+/);
  const checks = tokens.map(comparator);
  if (tokens.length === 0 || checks.some((c) => c === undefined)) throw new Error(`unsupported semver range: "${range}"`);
  return checks.every((c) => (c as (v: Version) => boolean)(v.v));
}
