import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createApiServer } from '../src/index.js';

describe('openapi drift', () => {
  it('committed openapi.json matches the live route surface (regen: pnpm -F @aeos/api gen:openapi)', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aeos-openapi-drift-'));
    const app = await createApiServer({
      home,
      adapterFor: () => {
        throw new Error('never spawns');
      },
      credentialFor: () => {
        throw new Error('never resolves');
      },
    });
    await app.ready();
    const live = JSON.parse(JSON.stringify(app.swagger())) as Record<string, unknown>;
    await app.close();
    await rm(home, { recursive: true, force: true });

    const committed = JSON.parse(
      await readFile(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(live).toEqual(committed);
  });
});
