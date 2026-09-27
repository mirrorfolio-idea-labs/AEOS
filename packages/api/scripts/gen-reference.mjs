// Regenerate docs/reference/api.md from the committed openapi.json
// (drift-tested in CI): pnpm -F @aeos/api gen:reference   (after pnpm build)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderApiReference } from '../dist/reference.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(await readFile(path.join(here, '..', 'openapi.json'), 'utf8'));
const out = path.resolve(here, '..', '..', '..', 'docs', 'reference', 'api.md');
await writeFile(out, renderApiReference(spec));
console.log(`wrote ${out}`);
