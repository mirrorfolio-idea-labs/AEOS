import fs from 'node:fs';
import path from 'node:path';
import type { AeosEvent } from '@aeos/contracts';
import { auditDir } from '../home/paths.js';
import type { EventBus } from '../bus/bus.js';

/** Event classes that land in the audit trail (spec §11 audit). */
const AUDITED_TYPES = new Set([
  'session.created',
  'session.completed',
  'session.failed',
  'item.tool_call',
  'item.tool_result',
  'approval.request',
  'approval.resolved',
  'policy.blocked',
  'budget.exceeded',
  'cost.usage',
  'memory.written',
]);

const auditPathFor = (home: string, utcDay: string): string =>
  path.join(auditDir(home), `audit-${utcDay}.ndjson`);

/**
 * Append-only audit writer (spec §7 layout, §11 semantics): every audited
 * event appends one NDJSON line to `audit/audit-<UTC-date>.ndjson`. Writes go
 * through fs.appendFileSync ONLY — no code path truncates or rewrites an
 * audit file, and date rollover starts a new file rather than touching the
 * previous day's. Returns the unsubscribe function.
 */
export function attachAuditWriter(bus: EventBus, home: string): () => void {
  const handler = (event: AeosEvent): void => {
    if (!AUDITED_TYPES.has(event.type)) return;
    const day = event.ts.slice(0, 10);
    const line = `${JSON.stringify({ ...event, auditVersion: 1 })}\n`;
    fs.mkdirSync(auditDir(home), { recursive: true });
    fs.appendFileSync(auditPathFor(home, day), line);
  };
  return bus.subscribe({}, handler);
}
