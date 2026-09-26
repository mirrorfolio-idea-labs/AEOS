import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigSchema, TASK_CLASSES, type TaskClass } from '@aeos/contracts';
import {
  STATIC_PRICING,
  appendRouteRecord,
  estimateUsd,
  loadPricingIndex,
  loadRoutingPolicy,
  parseOpenRouterModels,
  pricingPath,
  readRouteRecords,
  routeTask,
} from '../src/index.js';

const fixture = JSON.parse(
  fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'openrouter-models.json'), 'utf8'),
) as unknown;

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-router-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const okFetch = (async () => new Response(JSON.stringify(fixture), { status: 200 })) as unknown as typeof fetch;
const downFetch = (async () => {
  throw new Error('ENOTFOUND openrouter.ai');
}) as unknown as typeof fetch;

describe('pricing index (P3.M2.T1)', () => {
  it('parses the recorded OpenRouter fixture into per-MTok prices under vendor and bare ids', () => {
    const models = parseOpenRouterModels(fixture);
    expect(models['anthropic/claude-sonnet-5']).toEqual({ inputPerMTok: 2, outputPerMTok: 10, contextLength: 1_000_000 });
    expect(models['gpt-5-codex']).toEqual({ inputPerMTok: 1.25, outputPerMTok: 10, contextLength: 400_000 });
    expect(models['openrouter/auto']).toBeUndefined(); // dynamic (-1) pricing is skipped, never guessed
  });

  it('refresh writes the cache; within a day it is served without the network', async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify(fixture));
    }) as unknown as typeof fetch;
    const first = await loadPricingIndex({ home, fetchImpl: counting, now: () => Date.parse('2026-09-26T00:00:00Z') });
    expect(first).toMatchObject({ source: 'openrouter', stale: false });
    expect(fs.existsSync(pricingPath(home))).toBe(true);
    const second = await loadPricingIndex({ home, fetchImpl: counting, now: () => Date.parse('2026-09-26T12:00:00Z') });
    expect(second.stale).toBe(false);
    expect(calls).toBe(1);
  });

  it('accept: the index survives network-down (stale-but-served)', async () => {
    await loadPricingIndex({ home, fetchImpl: okFetch, now: () => Date.parse('2026-09-20T00:00:00Z') });
    const later = await loadPricingIndex({ home, fetchImpl: downFetch, now: () => Date.parse('2026-09-26T00:00:00Z') });
    expect(later).toMatchObject({ source: 'openrouter', stale: true, fetchedAt: '2026-09-20T00:00:00.000Z' });
    expect(later.models['gpt-5-codex']).toBeDefined();
    // no cache at all and no network → the static first-party table
    fs.rmSync(pricingPath(home));
    const cold = await loadPricingIndex({ home, fetchImpl: downFetch });
    expect(cold).toMatchObject({ source: 'static', stale: true });
    expect(cold.models['claude-opus-5']).toEqual(STATIC_PRICING['claude-opus-5']);
  });

  it('estimates USD from tokens (Codex reports tokens only)', () => {
    const index = { models: parseOpenRouterModels(fixture) };
    expect(estimateUsd(index, 'gpt-5-codex', { input: 1_000_000, output: 100_000 })).toBeCloseTo(2.25, 6);
    expect(estimateUsd(index, 'nope', { input: 1, output: 1 })).toBeUndefined();
    expect(estimateUsd(index, undefined, { input: 1, output: 1 })).toBeUndefined();
  });
});

const agent = (provider: 'claude-code' | 'codex' | 'opencode', prefs?: Record<string, string>) =>
  AgentConfigSchema.parse({
    id: 'dev',
    workspaceId: 'ws',
    name: 'Dev',
    harness: { provider, featureToggles: {} },
    credentialProfileId: 'cp',
    ...(prefs === undefined ? {} : { modelPreferences: prefs }),
  });

describe('routing policy engine (P3.M2.T2)', () => {
  it('accept: fixture matrix (class × policy) routes as documented', () => {
    fs.mkdirSync(path.join(home, 'workspaces', 'ws'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'routing.yaml'),
      'default: { thinking: medium }\nclasses:\n  review: { model: claude-fable-5-1, thinking: max }\n  implement: { provider: codex }\n',
    );
    fs.writeFileSync(
      path.join(home, 'workspaces', 'ws', 'routing.yaml'),
      'classes:\n  implement: { model: gpt-5-codex }\n  docs: { provider: opencode }\n',
    );
    const routing = loadRoutingPolicy(home, 'ws');
    const table = (TASK_CLASSES as readonly TaskClass[]).map((cls) => {
      const d = routeTask(agent('claude-code'), cls, routing);
      return `${cls}:${d.provider}:${d.model ?? '-'}:${d.thinking ?? '-'}`;
    });
    expect(table).toEqual([
      'plan:claude-code:claude-opus-5:medium',
      'architect:claude-code:claude-opus-5:medium',
      'implement:codex:gpt-5-codex:medium', // provider from home, model from workspace
      'refactor:claude-code:claude-sonnet-5:medium',
      'review:claude-code:claude-fable-5-1:max',
      'security_review:claude-code:claude-opus-5:medium',
      'summarize:claude-code:claude-haiku-4-5:medium',
      'docs:opencode:-:medium', // non-Claude harness keeps its own default model
      'rename:claude-code:claude-haiku-4-5:medium',
      'verify:claude-code:-:medium',
    ]);
  });

  it('no routing files: frontier/mid/small split for claude-code; other harnesses untouched', () => {
    expect(routeTask(agent('claude-code'), 'plan', {})).toMatchObject({ model: 'claude-opus-5', thinking: 'high', modelSource: 'default' });
    expect(routeTask(agent('claude-code'), 'implement', {})).toMatchObject({ model: 'claude-sonnet-5', thinking: undefined });
    expect(routeTask(agent('codex'), 'plan', {})).toMatchObject({ provider: 'codex', model: undefined, modelSource: 'harness' });
  });

  it('agent modelPreferences beat every file layer', () => {
    const routing = { home: { classes: { implement: { model: 'x' } } } };
    expect(routeTask(agent('claude-code', { implement: 'claude-opus-5' }), 'implement', routing)).toMatchObject({
      model: 'claude-opus-5',
      modelSource: 'agent',
    });
  });

  it('rejects typos loudly', () => {
    fs.writeFileSync(path.join(home, 'routing.yaml'), 'classes:\n  implemnt: { model: x }\n');
    expect(() => loadRoutingPolicy(home, 'ws')).toThrow();
  });
});

describe('route records (P3.M2.T3)', () => {
  it('append-only per attempt, queryable back', () => {
    const decision = routeTask(agent('codex'), 'implement', {});
    const record = {
      ts: '2026-09-26T00:00:00Z',
      taskId: 'T1',
      decision,
      pricingSource: 'static' as const,
      pricingStale: true,
      realized: { status: 'completed' as const, usd: 0, tokens: { input: 10, output: 5 } },
    };
    appendRouteRecord(home, record);
    appendRouteRecord(home, { ...record, taskId: 'T2' });
    expect(readRouteRecords(home).map((r) => r.taskId)).toEqual(['T1', 'T2']);
  });
});
