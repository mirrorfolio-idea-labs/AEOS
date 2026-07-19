// Regenerate the committed OpenAPI 3.1 spec (drift-tested in CI, like
// contracts schemas): pnpm -F @aeos/api gen:openapi
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer } from '../dist/index.js';

const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-openapi-'));
const app = await createApiServer({
  home,
  adapterFor: () => {
    throw new Error('spec generation never spawns');
  },
  credentialFor: () => {
    throw new Error('spec generation never resolves credentials');
  },
});
await app.ready();
const spec = app.swagger();
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json');
await writeFile(out, JSON.stringify(spec, null, 2) + '\n');
await app.close();
console.log(`wrote ${out} (${Object.keys(spec.paths ?? {}).length} paths)`);
