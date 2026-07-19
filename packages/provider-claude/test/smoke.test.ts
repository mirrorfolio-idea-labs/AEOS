/**
 * Manual, budget-capped live smoke (M4 exit gate). Skipped unless
 * AEOS_LIVE_SMOKE=1 — CI never runs this. Requires `claude` on PATH and
 * ANTHROPIC_API_KEY in the environment. Run via:
 *
 *   AEOS_LIVE_SMOKE=1 pnpm -F @aeos/provider-claude test:smoke
 *
 * Operator walkthrough: guides/2026-07-19-m4-exit-gate-live-smoke.md
 */
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AeosEventSchema,
  AgentConfigSchema,
  CredentialProfileSchema,
} from '@aeos/contracts';
import { ClaudeAdapter } from '../src/adapter.js';

const live = process.env['AEOS_LIVE_SMOKE'] === '1';

describe.skipIf(!live)('live smoke — real hermetic Claude Code session', () => {
  it('completes a tiny objective end-to-end through the adapter', async () => {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    expect(apiKey, 'export ANTHROPIC_API_KEY before running the smoke').toBeTruthy();

    const agent = AgentConfigSchema.parse({
      id: 'smoke-agent',
      workspaceId: 'smoke-ws',
      name: 'Smoke Agent',
      harness: { provider: 'claude-code', featureToggles: {} },
      credentialProfileId: 'cp-smoke',
    });
    const adapter = new ClaudeAdapter({
      agentDir: () => mkdtempSync(path.join(os.tmpdir(), 'aeos-smoke-')),
      credential: () =>
        CredentialProfileSchema.parse({ id: 'cp-smoke', kind: 'api-key', secretRef: 'env' }),
      secrets: { resolve: () => Promise.resolve(apiKey as string) },
    });

    const profile = await adapter.createProfile(agent);
    const handle = adapter.spawn({
      profile,
      sessionId: 'smoke-session',
      // Budget cap = objective design: a one-liner with no tool use needed.
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
    expect(handle.costUsd).toBeGreaterThan(0);
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
