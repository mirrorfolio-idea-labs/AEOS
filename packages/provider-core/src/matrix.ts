import type { CapabilityMatrix } from './adapter.js';

/**
 * The cross-harness capability matrix of record (P2.M6.T3). Every adapter
 * must declare EXACTLY these capabilities in its conformance subject — a
 * code change that diverges fails that adapter's suite, and
 * `test/capability-matrix.test.ts` fails if README drifts from this table.
 * Hand-edits are therefore enforced, not trusted.
 */
export const ADAPTER_MATRIX = {
  'claude-code': {
    resume: true,
    structuredOutput: true,
    mcp: true,
    sandbox: true,
    costReporting: true,
    costUsd: true,
  },
  codex: {
    resume: true,
    structuredOutput: true,
    mcp: false,
    sandbox: true,
    costReporting: true,
    costUsd: false, // tokens only — codex reports no pricing (P3.M2 router may derive it)
  },
  opencode: {
    resume: true,
    structuredOutput: true,
    mcp: true,
    sandbox: false,
    costReporting: true,
    costUsd: true,
  },
  fake: {
    resume: true,
    structuredOutput: true,
    mcp: false,
    sandbox: false,
    costReporting: true,
    costUsd: true,
  },
} as const satisfies Record<string, CapabilityMatrix>;

export type AdapterId = keyof typeof ADAPTER_MATRIX;
