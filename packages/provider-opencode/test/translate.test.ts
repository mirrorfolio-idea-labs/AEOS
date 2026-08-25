import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OpencodeStreamTranslator } from '../src/translate.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function goldenTranslator(): OpencodeStreamTranslator {
  let counter = 0;
  return new OpencodeStreamTranslator({
    sessionId: 'golden-session',
    profileId: 'cp-golden',
    newId: () => String(counter++).padStart(26, '0'),
    now: () => '2026-01-01T00:00:00.000Z',
  });
}

async function translateFixture(name: string) {
  const translator = goldenTranslator();
  const ndjson = await readFile(path.join(fixturesDir, name), 'utf8');
  return { events: translator.translateStream(ndjson), translator };
}

describe('golden translation', () => {
  for (const name of ['basic-session', 'failing-session', 'modern-session']) {
    it(`${name}.ndjson translates byte-identically to its expected file`, async () => {
      const { events } = await translateFixture(`${name}.ndjson`);
      const expected = await readFile(path.join(fixturesDir, `${name}.expected.json`), 'utf8');
      expect(JSON.stringify(events, null, 2) + '\n').toBe(expected);
    });
  }
});

describe('translation semantics', () => {
  it('opens the session on first sight of the provider session id', async () => {
    const { events, translator } = await translateFixture('basic-session.ndjson');
    expect(events[0]?.type).toBe('session.created');
    expect(events.filter((e) => e.type === 'session.created')).toHaveLength(1);
    expect(translator.providerSessionId).toBe('ses_basic01');
  });

  it('terminal tool parts become call+result pairs; cost is captured and profile-tagged', async () => {
    const { events, translator } = await translateFixture('basic-session.ndjson');
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'session.created',
      'item.message',
      'item.tool_call',
      'item.tool_result',
      'item.message',
      'cost.usage',
      'session.completed',
    ]);
    const cost = events.find((e) => e.type === 'cost.usage');
    expect(cost?.type === 'cost.usage' && cost.payload.profileId).toBe('cp-golden');
    expect(cost?.type === 'cost.usage' && cost.payload.cacheReadTokens).toBe(700);
    expect(translator.costUsd).toBeCloseTo(0.0098);
  });

  it('≥1.18 step shapes: text part becomes the message, stop finish completes, cost is captured', async () => {
    const { events, translator } = await translateFixture('modern-session.ndjson');
    const types = events.map((e) => e.type);
    expect(types).toEqual(['session.created', 'item.message', 'cost.usage', 'session.completed']);
    const message = events[1];
    expect(message?.type === 'item.message' && message.payload.text).toBe('pong');
    const cost = events.find((e) => e.type === 'cost.usage');
    expect(cost?.type === 'cost.usage' && cost.payload.profileId).toBe('cp-golden');
    expect(cost?.type === 'cost.usage' && cost.payload.usd).toBeCloseTo(0.023376);
    expect(translator.costUsd).toBeCloseTo(0.023376);
  });

  it('unknown and non-JSON lines are counted; session.error ends in session.failed with the message', async () => {
    const { events, translator } = await translateFixture('failing-session.ndjson');
    expect(translator.skippedLines).toBe(2);
    const last = events.at(-1);
    expect(last?.type).toBe('session.failed');
    expect(last?.type === 'session.failed' && last.payload.reason).toBe(
      'Provider authentication failed.',
    );
  });

  it('fixtures contain no secret material', async () => {
    for (const name of [
      'basic-session.ndjson',
      'failing-session.ndjson',
      'continuation-session.ndjson',
      'modern-session.ndjson',
    ]) {
      expect(await readFile(path.join(fixturesDir, name), 'utf8')).not.toMatch(
        /sk-[A-Za-z0-9_-]{8,}/,
      );
    }
  });
});
