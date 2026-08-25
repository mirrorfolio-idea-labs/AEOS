import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { ObjectiveSchema, type Objective } from '@aeos/contracts';

/**
 * Structured objective file (spec §12: objectives are durable files carrying
 * goal + constraints + BUDGET). Optional companion to `objective.md` — when
 * `<objectiveDir>/objective.yaml` exists it parses against ObjectiveSchema;
 * absence simply means "no budget config".
 */
export function readObjectiveFile(objectiveDir: string): Objective | undefined {
  const file = path.join(objectiveDir, 'objective.yaml');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  return ObjectiveSchema.parse(parse(text));
}
