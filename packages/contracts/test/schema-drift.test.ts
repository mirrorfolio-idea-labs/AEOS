import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateAllSchemas } from '../scripts/gen-schemas.js';

const schemasDir = join(import.meta.dirname, '../schemas');

describe('generated JSON Schemas', () => {
  it('committed schemas match regenerated output (no drift)', () => {
    const generated = generateAllSchemas();
    const committed = Object.fromEntries(
      readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json'))
        .map((f) => [f, readFileSync(join(schemasDir, f), 'utf8')]),
    );
    expect(committed).toEqual(generated);
  });

  it('covers the core contract surface', () => {
    expect(Object.keys(generateAllSchemas()).sort()).toEqual([
      'aeos-event.schema.json',
      'agent-config.schema.json',
      'checkpoint.schema.json',
      'compiled-policy.schema.json',
      'credential-profile.schema.json',
      'envelope-base.schema.json',
      'objective.schema.json',
      'plan-task.schema.json',
      'policy.schema.json',
      'session-record.schema.json',
      'workspace.schema.json',
    ]);
  });
});
