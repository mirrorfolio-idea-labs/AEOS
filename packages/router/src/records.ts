import fs from 'node:fs';
import path from 'node:path';
import type { RouteDecision } from './policy.js';

/** One routed task attempt with its realized cost (P3.M2.T3). */
export interface RouteRecord {
  ts: string;
  taskId: string;
  decision: RouteDecision;
  /** Pricing source used for any derived USD. */
  pricingSource: 'openrouter' | 'static';
  pricingStale: boolean;
  realized: {
    status: 'completed' | 'failed' | 'paused';
    /** USD the harness reported. */
    usd: number;
    tokens: { input: number; output: number };
    /** Token-priced USD when the harness reports tokens only (e.g. Codex). */
    derivedUsd?: number;
  };
}

export const routesPath = (objectiveDir: string): string => path.join(objectiveDir, 'routes.ndjson');

/** Append-only: every attempt is a line, so re-dos stay visible to tuning. */
export function appendRouteRecord(objectiveDir: string, record: RouteRecord): void {
  fs.appendFileSync(routesPath(objectiveDir), JSON.stringify(record) + '\n');
}

export function readRouteRecords(objectiveDir: string): RouteRecord[] {
  let text: string;
  try {
    text = fs.readFileSync(routesPath(objectiveDir), 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RouteRecord);
}
