// Regenerate docs/reference/cli.md from the CLI usage text (drift-tested in
// CI): pnpm -F @aeos/cli gen:reference   (after pnpm build)
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCliReference } from '../dist/reference.js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'reference', 'cli.md');
await writeFile(out, renderCliReference());
console.log(`wrote ${out}`);
