import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderApiReference, type OpenApiDocument } from '../src/reference.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('API reference drift (P5.M6.T5)', () => {
  it('docs/reference/api.md matches openapi.json (regen: pnpm -F @aeos/api gen:reference)', async () => {
    const spec = JSON.parse(await readFile(path.join(here, '..', 'openapi.json'), 'utf8')) as OpenApiDocument;
    const page = await readFile(path.resolve(here, '..', '..', '..', 'docs', 'reference', 'api.md'), 'utf8');
    expect(page).toBe(renderApiReference(spec));
    for (const route of Object.keys(spec.paths)) expect(page).toContain(`\`${route}\``);
  });
});
