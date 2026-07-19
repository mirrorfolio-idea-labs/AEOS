import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeStreamTranslator } from '../src/translate.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Deterministic translator so goldens are byte-stable (ids = padded counter). */
function goldenTranslator(): ClaudeStreamTranslator {
  let counter = 0;
  return new ClaudeStreamTranslator({
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
  for (const name of ['basic-session', 'failing-session']) {
    it(`${name}.ndjson translates byte-identically to its expected file`, async () => {
      const { events } = await translateFixture(`${name}.ndjson`);
      const expected = await readFile(path.join(fixturesDir, `${name}.expected.json`), 'utf8');
      expect(JSON.stringify(events, null, 2) + '\n').toBe(expected);
    });
  }
});

describe('translation semantics', () => {
  it('captures provider session id and cost from the stream', async () => {
    const { translator } = await translateFixture('basic-session.ndjson');
    expect(translator.providerSessionId).toBe('prov-sess-basic');
    expect(translator.costUsd).toBeCloseTo(0.0123);
  });

  it('emits cost.usage before the terminal event, tagged with the profile id', async () => {
    const { events } = await translateFixture('basic-session.ndjson');
    const types = events.map((e) => e.type);
    expect(types.indexOf('cost.usage')).toBe(types.length - 2);
    expect(types.at(-1)).toBe('session.completed');
    const cost = events.find((e) => e.type === 'cost.usage');
    expect(cost?.type === 'cost.usage' && cost.payload.profileId).toBe('cp-golden');
    expect(cost?.type === 'cost.usage' && cost.payload.cacheReadTokens).toBe(800);
  });

  it('unknown and non-JSON lines are counted, never crash, and errors end in session.failed', async () => {
    const { events, translator } = await translateFixture('failing-session.ndjson');
    expect(translator.skippedLines).toBe(2);
    const last = events.at(-1);
    expect(last?.type).toBe('session.failed');
    expect(last?.type === 'session.failed' && last.payload.reason).toContain('max turns');
  });

  it('fixtures contain no secret material', async () => {
    for (const name of ['basic-session.ndjson', 'failing-session.ndjson']) {
      const raw = await readFile(path.join(fixturesDir, name), 'utf8');
      expect(raw).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    }
  });
});
