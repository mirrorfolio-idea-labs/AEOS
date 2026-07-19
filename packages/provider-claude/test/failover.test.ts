import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AeosEventSchema } from '@aeos/contracts';
import {
  CREDENTIAL_FAILOVER_ACTION,
  evaluateUsageLimit,
  isUsageLimitFailure,
} from '../src/failover.js';
import { ClaudeStreamTranslator } from '../src/translate.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function translated(name: string) {
  const translator = new ClaudeStreamTranslator({ sessionId: 'sess-limit', profileId: 'cp-main' });
  return translator.translateStream(await readFile(path.join(fixturesDir, name), 'utf8'));
}

describe('usage-limit failover hook', () => {
  it('detects the usage-limit failure signature in the translated stream', async () => {
    expect(isUsageLimitFailure(await translated('usage-limit-session.ndjson'))).toBe(true);
    expect(isUsageLimitFailure(await translated('basic-session.ndjson'))).toBe(false);
    expect(isUsageLimitFailure(await translated('failing-session.ndjson'))).toBe(false);
  });

  it('policy=confirm emits a schema-valid approval.request with the documented action', async () => {
    const decision = evaluateUsageLimit(await translated('usage-limit-session.ndjson'), {
      policy: 'confirm',
      fallbackProfileId: 'cp-fallback',
      sessionId: 'sess-limit',
      resumeToken: 'prov-sess-limit',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      expiresInMs: 60_000,
    });
    expect(decision.kind).toBe('approval');
    if (decision.kind !== 'approval') return;
    const event = AeosEventSchema.parse(decision.event);
    expect(event.type).toBe('approval.request');
    if (event.type !== 'approval.request') return;
    expect(event.payload.action).toBe(CREDENTIAL_FAILOVER_ACTION);
    expect(event.payload.detail).toContain('cp-fallback');
    expect(event.payload.expiresAt).toBe('2026-01-01T00:01:00.000Z');
  });

  it('policy=allow returns a switch decision carrying the fallback profile + resume token', async () => {
    const decision = evaluateUsageLimit(await translated('usage-limit-session.ndjson'), {
      policy: 'allow',
      fallbackProfileId: 'cp-fallback',
      sessionId: 'sess-limit',
      resumeToken: 'prov-sess-limit',
    });
    expect(decision).toEqual({
      kind: 'switch',
      fallbackProfileId: 'cp-fallback',
      resumeToken: 'prov-sess-limit',
    });
  });

  it('a normally-failed session triggers no failover under either policy', async () => {
    const events = await translated('failing-session.ndjson');
    for (const policy of ['confirm', 'allow'] as const) {
      expect(
        evaluateUsageLimit(events, {
          policy,
          fallbackProfileId: 'cp-fallback',
          sessionId: 'sess-x',
        }).kind,
      ).toBe('none');
    }
  });
});
