import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AeosEvent } from '@aeos/contracts';
import { CodexStreamTranslator } from '../src/translate.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixtureLines = (name: string) =>
  readFile(path.join(fixturesDir, name), 'utf8').then((s) =>
    s.split('\n').filter((l) => l.trim().length > 0),
  );

/** Deterministic translator over a fixture file — byte-stable goldens. */
async function golden(name: string): Promise<string> {
  const translator = new CodexStreamTranslator({
    sessionId: 'translate',
    profileId: 'cp-fixture',
    newId: (() => {
      let n = 0;
      return () => String(n++).padStart(26, '0');
    })(),
    now: () => '2026-01-01T00:00:00.000Z',
  });
  const events: AeosEvent[] = [];
  for (const line of await fixtureLines(name)) {
    events.push(...translator.translateLine(JSON.parse(line)));
  }
  events.push(...translator.sessionEnd());
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

describe('CodexStreamTranslator (P2.M6.T1)', () => {
  it('translates the recorded session byte-identically to the committed golden', async () => {
    const expectedPath = path.join(fixturesDir, 'session.expected.jsonl');
    const actual = await golden('session.ndjson');
    // first run materializes the golden; every later run must match exactly
    try {
      const expected = await readFile(expectedPath, 'utf8');
      expect(actual).toBe(expected);
    } catch {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(expectedPath, actual);
      expect(await readFile(expectedPath, 'utf8')).toBe(actual); // determinism proof
    }
  });

  it('splits command_execution into a tool_call/tool_result pair keyed by item id', async () => {
    const translator = new CodexStreamTranslator({ sessionId: 's', profileId: 'p' });
    const events = translator.translateLine({
      type: 'item.completed',
      item: {
        id: 'item_9',
        type: 'command_execution',
        command: "bash -lc 'echo hi'",
        aggregated_output: 'hi\n',
        exit_code: 2,
        status: 'completed',
      },
    });
    expect(events.map((e) => e.type)).toEqual(['item.tool_call', 'item.tool_result']);
    expect(events[0]!.payload).toEqual({
      callId: 'item_9',
      tool: 'shell',
      input: { command: "bash -lc 'echo hi'" },
    });
    expect(events[1]!.payload).toEqual({ callId: 'item_9', ok: false, output: 'hi\n' });
  });

  it('maps turn usage to cost.usage with token fidelity and usd unset', async () => {
    const translator = new CodexStreamTranslator({ sessionId: 's', profileId: 'cp-x' });
    expect(translator.translateLine({ type: 'turn.started' })).toEqual([]);
    const events = translator.translateLine({
      type: 'turn.completed',
      usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 },
    });
    expect(events.map((e) => e.type)).toEqual(['cost.usage']);
    expect(events[0]!.payload).toEqual({
      profileId: 'cp-x',
      usd: 0,
      inputTokens: 100,
      outputTokens: 7,
      cacheReadTokens: 40,
    });
    expect(translator.costUsd).toBeUndefined();
  });

  it('surfaces unknown item types as system messages and skips unknown lines', () => {
    const translator = new CodexStreamTranslator({ sessionId: 's', profileId: 'p' });
    const unknownItem = translator.translateLine({
      type: 'item.completed',
      item: { id: 'i', type: 'web_search_call', query: 'x' },
    });
    expect(unknownItem).toHaveLength(1);
    expect(unknownItem[0]!.type).toBe('item.message');

    const unknownLine = translator.translateLine({ type: 'mystery_event', x: 1 });
    expect(unknownLine).toEqual([]);
    expect(translator.skippedLines).toBe(1);
  });

  it('resume fixture: new thread id still opens once and completes cleanly', async () => {
    const translator = new CodexStreamTranslator({
      sessionId: 'translate-resume',
      profileId: 'cp-fixture',
      newId: (() => {
        let n = 0;
        return () => String(n++).padStart(26, '0');
      })(),
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const types: string[] = [];
    for (const line of await fixtureLines('resume.ndjson')) {
      types.push(...translator.translateLine(JSON.parse(line)).map((e) => e.type));
    }
    types.push(...translator.sessionEnd().map((e) => e.type));
    expect(types).toEqual([
      'session.created',
      'item.message',
      'cost.usage',
      'session.completed',
    ]);
    expect(translator.providerSessionId).toMatch(/^01a03a3e/);
  });
});
