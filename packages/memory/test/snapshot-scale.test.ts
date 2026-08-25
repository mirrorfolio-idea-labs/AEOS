import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeSnapshot, initMemoryLayout, writeMemoryFile } from '../src/index.js';

/**
 * Scale + perf-baseline coverage for the snapshot composer (V3 overnight
 * gauntlet). Determinism and budget correctness are asserted at ~200-file
 * scale; latency is printed as a human baseline only — never asserted.
 */

function perf(label: string, ms: number): void {
  console.info(`[perf] ${label}: ${ms.toFixed(1)}ms`);
}

describe('memory snapshot composer at ~200-file scale (V3 baselines)', () => {
  let root: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-scale-memory-'));
    await initMemoryLayout(root);
    const body = `${'Lorem ipsum dolor sit amet consectetur. '.repeat(21)}\n`;
    const plan: Array<[string, number]> = [
      ['identity', 3],
      ['preferences', 17],
      ['decisions', 17],
      ['lessons', 26],
      ['mistakes', 17],
      ['architecture', 26],
      ['roadmap', 17],
      ['experiments', 17],
      ['research', 34],
      ['knowledge', 34],
    ];
    const t0 = performance.now();
    for (const [dir, count] of plan) {
      for (let i = 0; i < count; i++) {
        await writeMemoryFile(root, `${dir}/file-${String(i).padStart(3, '0')}.md`, body, {
          title: `${dir} ${i}`,
          hook: `${dir} fixture ${i}`,
        });
      }
    }
    perf('build 208-file memory tree', performance.now() - t0);
  }, 120_000);

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('compose stays deterministic and within budget at 40k chars', async () => {
    const t0 = performance.now();
    const a = await composeSnapshot(root, { charBudget: 40_000 });
    const b = await composeSnapshot(root, { charBudget: 40_000 });
    perf('composeSnapshot 208 files @40k budget', performance.now() - t0);

    expect(a.text).toBe(b.text);
    expect(a.includedFiles).toEqual(b.includedFiles);
    expect(a.totalChars).toBeLessThanOrEqual(40_000);
    expect(a.includedFiles.length + a.skippedFiles.length).toBe(208);
  });

  it('unlimited budget includes every file byte-identically across runs', async () => {
    const t0 = performance.now();
    const a = await composeSnapshot(root, { charBudget: 1_000_000 });
    perf('composeSnapshot 208 files @1M budget (all included)', performance.now() - t0);

    expect(a.skippedFiles).toEqual([]);
    const b = await composeSnapshot(root, { charBudget: 1_000_000 });
    expect(a.text).toBe(b.text);
  });
});
