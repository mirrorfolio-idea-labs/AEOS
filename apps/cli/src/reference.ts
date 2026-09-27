import { USAGE } from './cli.js';

/**
 * docs/reference/cli.md, rendered from the CLI's own usage text (P5.M6.T5).
 * The usage string is the single source: `pnpm -F @aeos/cli gen:reference`
 * writes the page and test/reference-drift.test.ts fails when they differ.
 */
export function renderCliReference(usage: string = USAGE): string {
  const [, ...rest] = usage.split('\n');
  const groups = new Map<string, string[][]>();
  let current: string[] | undefined;
  for (const raw of rest) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') continue;
    const trimmed = line.trimStart();
    if (trimmed.startsWith('aeos ')) {
      const command = trimmed.split(/\s+/)[1] ?? '';
      current = [trimmed];
      const entries = groups.get(command) ?? [];
      entries.push(current);
      groups.set(command, entries);
    } else if (current !== undefined) {
      // continuation of the previous entry (wrapped flags or a trailing comment)
      current.push(`  ${trimmed}`);
    }
  }

  const out = [
    '# CLI reference',
    '',
    '<!-- Generated from the `aeos` usage text by `pnpm -F @aeos/cli gen:reference`.',
    '     Do not edit by hand: CI fails when this page and the CLI disagree. -->',
    '',
    '`aeos` is the command-line client for the AEOS daemon. It talks to a running',
    'daemon at `AEOS_API_URL` (default `http://127.0.0.1:7777`); set',
    '`AEOS_API_TOKEN` when the daemon requires a token. The `harness`, `service`',
    'and `sandbox` commands work on this machine directly.',
    '',
    `Commands: ${[...groups.keys()].map((c) => `[\`${c}\`](#aeos-${c})`).join(' · ')}`,
  ];
  for (const [command, entries] of groups) {
    out.push('', `## aeos ${command}`, '', '```bash');
    for (const entry of entries) out.push(...entry);
    out.push('```');
  }
  return out.join('\n') + '\n';
}
