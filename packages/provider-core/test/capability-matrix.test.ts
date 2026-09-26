import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADAPTER_MATRIX } from '../src/matrix.js';

/**
 * P2.M6.T3 accept: the cross-harness capability matrix is asserted by
 * tests, not hand-maintained. README's adapter table must match
 * ADAPTER_MATRIX exactly — editing one without the other fails here.
 */
describe('capability matrix ↔ README (P2.M6.T3)', () => {
  it('README adapter table matches ADAPTER_MATRIX row for row', async () => {
    const readme = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'README.md'),
      'utf8',
    );
    const marker = readme.indexOf('<!-- adapters:matrix -->');
    expect(marker, 'README must contain the <!-- adapters:matrix --> marker').toBeGreaterThan(-1);
    const section = readme.slice(marker);

    for (const [id, caps] of Object.entries(ADAPTER_MATRIX)) {
      const line = section
        .split('\n')
        .find((l) => l.startsWith('|') && l.toLowerCase().includes(id));
      expect(line, `README matrix is missing a row for ${id}`).toBeDefined();

      const cells = line!.split('|').map((c) => c.trim().toLowerCase().replaceAll('`', ''));
      // cells: ['', id, resume, structuredOutput, mcp, sandbox, costReporting, usd]
      expect(cells[1], `${id} row must name the adapter`).toBe(id);
      const values = [
        String(caps.resume),
        String(caps.structuredOutput),
        String(caps.mcp),
        String(caps.sandbox),
        String(caps.costReporting),
        caps.costUsd === false ? 'tokens' : 'usd',
      ];
      values.forEach((value, i) => {
        expect(cells[i + 2], `${id}: column ${i}`).toBe(value);
      });
    }
  });
});
