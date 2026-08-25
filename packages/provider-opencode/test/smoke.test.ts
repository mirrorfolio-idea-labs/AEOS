/**
 * Manual, budget-capped live smoke (M10 exit gate). Skipped unless
 * AEOS_LIVE_SMOKE=1 — CI never runs this. Requires `opencode` on PATH and
 * ANTHROPIC_API_KEY in the environment. Run via:
 *
 *   AEOS_LIVE_SMOKE=1 pnpm -F @aeos/provider-opencode test:smoke
 *
 * Gateway mode (e.g. dockerized runs through an Anthropic-compatible
 * proxy backed by a different upstream): set AEOS_SMOKE_GATEWAY_URL and
 * optionally AEOS_SMOKE_MODEL — the credential becomes a `gateway`
 * profile, so the child gets ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
 * (and ANTHROPIC_MODEL when a model override is given) instead of
 * ANTHROPIC_API_KEY.
 */
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AeosEventSchema, AgentConfigSchema, CredentialProfileSchema } from '@aeos/contracts';
import { OpencodeAdapter } from '../src/adapter.js';

const live = process.env['AEOS_LIVE_SMOKE'] === '1';
const gatewayUrl = process.env['AEOS_SMOKE_GATEWAY_URL'];
const modelOverride = process.env['AEOS_SMOKE_MODEL'];

const credentialFor = (apiKey: string) => {
  if (gatewayUrl === undefined) {
    return CredentialProfileSchema.parse({ id: 'cp-smoke', kind: 'api-key', secretRef: 'env' });
  }
  return CredentialProfileSchema.parse({
    id: 'cp-smoke',
    kind: 'gateway',
    baseUrl: gatewayUrl,
    secretRef: 'env',
    ...(modelOverride === undefined ? {} : { model: modelOverride }),
  });
};

describe.skipIf(!live)('live smoke — real hermetic OpenCode session', () => {
  it('completes a tiny objective end-to-end through the adapter', async () => {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    expect(apiKey, 'export ANTHROPIC_API_KEY before running the smoke').toBeTruthy();

    const agent = AgentConfigSchema.parse({
      id: 'smoke-oc-agent',
      workspaceId: 'smoke-ws',
      name: 'Smoke OpenCode Agent',
      harness: { provider: 'opencode', featureToggles: {} },
      credentialProfileId: 'cp-smoke',
    });
    const adapter = new OpencodeAdapter({
      agentDir: () => mkdtempSync(path.join(os.tmpdir(), 'aeos-oc-smoke-')),
      credential: () => credentialFor(apiKey as string),
      secrets: { resolve: () => Promise.resolve(apiKey as string) },
    });

    const profile = await adapter.createProfile(agent);
    const handle = adapter.spawn({
      profile,
      sessionId: 'smoke-session',
      objective: 'Reply with exactly the word: pong. Do nothing else.',
    });

    const types: string[] = [];
    for await (const event of handle.events) {
      AeosEventSchema.parse(event);
      types.push(event.type);
    }

    expect(types[0]).toBe('session.created');
    expect(types.at(-1)).toBe('session.completed');
    expect(handle.providerSessionId).toBeTruthy();
    // Intentional operator feedback — this test only runs manually.
    console.log('live smoke ok:', {
      providerSessionId: handle.providerSessionId,
      costUsd: handle.costUsd,
      events: types,
    });
  }, 180_000);
});

describe.skipIf(live)('live smoke placeholder', () => {
  it('is skipped without AEOS_LIVE_SMOKE=1 (see guides/ for the operator walkthrough)', () => {
    expect(live).toBe(false);
  });
});
