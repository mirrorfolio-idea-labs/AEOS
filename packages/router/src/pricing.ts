import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '@aeos/kernel';

/** USD per million tokens. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  contextLength?: number;
}

export interface PricingIndex {
  fetchedAt: string;
  source: 'openrouter' | 'static';
  models: Record<string, ModelPrice>;
}

export interface LoadedPricing extends PricingIndex {
  /** True when a refresh was due but failed — the cached (or static) index is served. */
  stale: boolean;
}

/**
 * Static first-party table (spec §13 "static tables for subscription
 * harnesses"): Anthropic API list prices, USD per MTok, as of 2026-09.
 * Always present; a live OpenRouter index extends it and never removes
 * these entries.
 */
export const STATIC_PRICING: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50, contextLength: 1_000_000 },
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, contextLength: 1_000_000 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25, contextLength: 1_000_000 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10, contextLength: 1_000_000 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, contextLength: 200_000 },
};

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const DAY_MS = 24 * 60 * 60 * 1000;

/** OpenRouter `/api/v1/models` — prices are USD-per-token decimal strings. */
const OpenRouterModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      context_length: z.number().nullable().optional(),
      pricing: z.object({ prompt: z.string(), completion: z.string() }).passthrough(),
    }).passthrough(),
  ),
});

/**
 * Normalize an OpenRouter listing: per-token → per-MTok, and index each
 * model under both its `vendor/model` id and the bare model id (what a
 * harness `--model` flag carries). Unparseable or negative ("-1" = dynamic)
 * prices are skipped rather than guessed.
 */
export function parseOpenRouterModels(json: unknown): Record<string, ModelPrice> {
  const parsed = OpenRouterModelsSchema.parse(json);
  const models: Record<string, ModelPrice> = {};
  for (const model of parsed.data) {
    const input = Number(model.pricing.prompt);
    const output = Number(model.pricing.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;
    const price: ModelPrice = {
      inputPerMTok: Math.round(input * 1e6 * 1e6) / 1e6,
      outputPerMTok: Math.round(output * 1e6 * 1e6) / 1e6,
      ...(typeof model.context_length === 'number' ? { contextLength: model.context_length } : {}),
    };
    models[model.id] = price;
    const bare = model.id.split('/').at(-1);
    if (bare !== undefined && bare !== model.id && models[bare] === undefined) models[bare] = price;
  }
  return models;
}

export const pricingPath = (home: string): string => path.join(home, 'router', 'pricing.json');

export interface LoadPricingOptions {
  home: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Refresh cadence (spec §13: daily). */
  maxAgeMs?: number;
  /** Never touch the network (tests, air-gapped installs). */
  offline?: boolean;
}

function readCache(home: string): PricingIndex | undefined {
  try {
    return JSON.parse(fs.readFileSync(pricingPath(home), 'utf8')) as PricingIndex;
  } catch {
    return undefined;
  }
}

function withStatic(index: PricingIndex): PricingIndex {
  return { ...index, models: { ...index.models, ...STATIC_PRICING } };
}

/**
 * The pricing index (P3.M2.T1): cached at `<home>/router/pricing.json`,
 * refreshed from OpenRouter when older than a day. Network down → the
 * stale cache is served (`stale: true`); no cache at all → the static
 * table. The index never fails a task.
 */
export async function loadPricingIndex(opts: LoadPricingOptions): Promise<LoadedPricing> {
  const now = opts.now ?? Date.now;
  const cached = readCache(opts.home);
  const fresh = cached !== undefined && now() - Date.parse(cached.fetchedAt) < (opts.maxAgeMs ?? DAY_MS);
  if (fresh) return { ...withStatic(cached), stale: false };
  const fallback = (): LoadedPricing =>
    cached !== undefined
      ? { ...withStatic(cached), stale: true }
      : { fetchedAt: new Date(0).toISOString(), source: 'static', models: { ...STATIC_PRICING }, stale: true };
  if (opts.offline === true) return fallback();
  try {
    const response = await (opts.fetchImpl ?? fetch)(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return fallback();
    const index: PricingIndex = {
      fetchedAt: new Date(now()).toISOString(),
      source: 'openrouter',
      models: parseOpenRouterModels(await response.json()),
    };
    fs.mkdirSync(path.dirname(pricingPath(opts.home)), { recursive: true });
    writeFileAtomic(pricingPath(opts.home), JSON.stringify(index, null, 2) + '\n');
    return { ...withStatic(index), stale: false };
  } catch {
    return fallback();
  }
}

/** USD for a token count at a model's price; `undefined` when the model is unknown. */
export function estimateUsd(
  index: Pick<PricingIndex, 'models'>,
  model: string | undefined,
  tokens: { input: number; output: number },
): number | undefined {
  if (model === undefined) return undefined;
  const price = index.models[model];
  if (price === undefined) return undefined;
  return (tokens.input * price.inputPerMTok + tokens.output * price.outputPerMTok) / 1e6;
}
