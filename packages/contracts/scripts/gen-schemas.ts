import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  AeosEventSchema, AgentConfigSchema, CheckpointSchema, CompiledPolicySchema,
  CredentialProfileSchema, EnvelopeBaseSchema, ObjectiveSchema, PlanTaskSchema,
  PolicyFileSchema, SessionRecordSchema, WorkspaceSchema,
} from '../src/index.js';

const SOURCES: Record<string, ZodTypeAny> = {
  'envelope-base': EnvelopeBaseSchema,
  'aeos-event': AeosEventSchema,
  'workspace': WorkspaceSchema,
  'credential-profile': CredentialProfileSchema,
  'agent-config': AgentConfigSchema,
  'session-record': SessionRecordSchema,
  'objective': ObjectiveSchema,
  'policy': PolicyFileSchema,
  'compiled-policy': CompiledPolicySchema,
  'plan-task': PlanTaskSchema,
  'checkpoint': CheckpointSchema,
};

export function generateAllSchemas(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, schema] of Object.entries(SOURCES)) {
    const json = zodToJsonSchema(schema, { name, $refStrategy: 'none' });
    out[`${name}.schema.json`] = JSON.stringify(json, null, 2) + '\n';
  }
  return out;
}

// CLI entry: write files when run directly (tsx scripts/gen-schemas.ts)
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../schemas');
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(generateAllSchemas())) {
    writeFileSync(join(dir, file), content);
    console.log(`wrote schemas/${file}`);
  }
}
