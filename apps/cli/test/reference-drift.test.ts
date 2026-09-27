import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { USAGE } from '../src/cli.js';
import { renderCliReference } from '../src/reference.js';

const page = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'reference', 'cli.md');

describe('CLI reference drift (P5.M6.T5)', () => {
  it('docs/reference/cli.md matches the CLI usage text (regen: pnpm -F @aeos/cli gen:reference)', async () => {
    expect(await readFile(page, 'utf8')).toBe(renderCliReference());
  });

  it('documents every command the usage text lists', () => {
    const rendered = renderCliReference();
    const commands = new Set([...USAGE.matchAll(/^\s+aeos (\S+)/gm)].map((m) => m[1]));
    expect(commands.size).toBeGreaterThan(10);
    for (const command of commands) expect(rendered).toContain(`## aeos ${command}`);
  });
});
