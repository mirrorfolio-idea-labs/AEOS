import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { writeFileAtomic } from '@aeos/kernel';
import { CheckpointSchema, type Checkpoint, type PlanTask } from '@aeos/contracts';
import type { ParsedPlan } from './plan.js';

const CHECKPOINTS_DIR = 'checkpoints';

export function checkpointPath(objectiveDir: string, taskId: string): string {
  return path.join(objectiveDir, CHECKPOINTS_DIR, `${taskId}.yaml`);
}

export async function writeCheckpoint(objectiveDir: string, checkpoint: Checkpoint): Promise<void> {
  await mkdir(path.join(objectiveDir, CHECKPOINTS_DIR), { recursive: true });
  await writeFileAtomic(
    checkpointPath(objectiveDir, checkpoint.taskId),
    stringifyYaml(CheckpointSchema.parse(checkpoint)),
  );
}

export async function readCheckpoints(objectiveDir: string): Promise<Map<string, Checkpoint>> {
  const checkpoints = new Map<string, Checkpoint>();
  let entries: string[];
  try {
    entries = await readdir(path.join(objectiveDir, CHECKPOINTS_DIR));
  } catch {
    return checkpoints;
  }
  for (const entry of entries.filter((e) => e.endsWith('.yaml')).sort()) {
    const raw = await readFile(path.join(objectiveDir, CHECKPOINTS_DIR, entry), 'utf8');
    const checkpoint = CheckpointSchema.parse(parseYaml(raw));
    checkpoints.set(checkpoint.taskId, checkpoint);
  }
  return checkpoints;
}

export type NextTaskResolution =
  | { kind: 'run'; task: PlanTask; attempts: number; resumeToken?: string }
  | { kind: 'done' }
  | { kind: 'paused'; task: PlanTask; reason: string };

/**
 * Recovery resolver (spec §12): given the plan and the checkpoints, decide
 * what happens next. Checkpoints are the LATER truth — after a crash the
 * plan file may lag (e.g. still `[~]`) while the checkpoint already says
 * completed; the checkpoint wins. Transcripts are never consulted.
 */
export function resolveNextTask(
  plan: ParsedPlan,
  checkpoints: ReadonlyMap<string, Checkpoint>,
  maxAttempts: number,
): NextTaskResolution {
  for (const task of plan.tasks) {
    const checkpoint = checkpoints.get(task.id);
    const status = checkpoint?.status ?? task.status;
    if (status === 'completed') continue;
    if (status === 'blocked') {
      return { kind: 'paused', task, reason: `task ${task.id} is blocked` };
    }
    const attempts = checkpoint?.attempts ?? 0;
    if (attempts >= maxAttempts) {
      return { kind: 'paused', task, reason: `task ${task.id} exhausted ${maxAttempts} attempts` };
    }
    return {
      kind: 'run',
      task,
      attempts,
      ...(checkpoint?.providerResumeToken === undefined
        ? {}
        : { resumeToken: checkpoint.providerResumeToken }),
    };
  }
  return { kind: 'done' };
}
