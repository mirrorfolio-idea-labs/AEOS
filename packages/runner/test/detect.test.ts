import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ScreenStateDetector,
  detectScreenState,
  extractRegion,
  loadManifest,
  parseManifest,
  rustRegex,
  type ScreenChange,
} from '../src/index.js';

const claude = loadManifest('claude-code')!;
const codex = loadManifest('codex')!;
const opencode = loadManifest('opencode')!;

const CLAUDE_IDLE = [
  '⏺ Done — the parser handles empty rows now.',
  '',
  '────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────',
  '  ? for shortcuts',
].join('\n');

const CLAUDE_WORKING = [
  '⏺ Reading src/parser.ts',
  '',
  '✻ Thinking… (12s · ↑ 1.2k tokens · esc to interrupt)',
  '',
  '────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────',
].join('\n');

const CLAUDE_BASH_PERMISSION = [
  ' Bash command',
  '',
  '   rm -rf build',
  '   Remove the build directory',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for rm commands in /work",
  '   3. No, and tell Claude what to do differently (esc)',
].join('\n');

describe('bundled herdr manifests (Apache-2.0) load and compile under JS regex', () => {
  it('parses all three harness manifests', () => {
    expect(claude.id).toBe('claude');
    expect(codex.id).toBe('codex');
    expect(opencode.id).toBe('opencode');
    expect(claude.rules.length).toBeGreaterThan(10);
    expect(loadManifest('fake')).toBeUndefined();
  });

  it('translates Rust regex syntax (inline flags, \\x{..}, \\A, \\z)', () => {
    expect(rustRegex('(?i)^yes').test('YES')).toBe(true);
    expect(rustRegex('^[\\x{2800}-\\x{28FF}] ').test('⠋ working')).toBe(true);
    expect(rustRegex('(?m)^b\\z').test('a\nb')).toBe(true);
    expect(rustRegex('(?m)^a\\z').test('a\nb')).toBe(false);
    expect(rustRegex('\\A> You').test('> You are in /x')).toBe(true);
  });
});

describe('screen classification (P2.M10.T1)', () => {
  it('claude: idle prompt box, live turn, bash permission prompt', () => {
    expect(detectScreenState(claude, { screen: CLAUDE_IDLE })).toMatchObject({ state: 'idle', rule: 'live_prompt_box' });
    expect(detectScreenState(claude, { screen: CLAUDE_WORKING })).toMatchObject({ state: 'working', rule: 'live_turn_working' });
    expect(detectScreenState(claude, { screen: CLAUDE_BASH_PERMISSION })).toMatchObject({
      state: 'blocked',
      rule: 'bash_permission_prompt',
    });
  });

  it('claude: OSC title spinner outranks the screen', () => {
    expect(detectScreenState(claude, { screen: CLAUDE_IDLE, oscTitle: '⠙ Claude Code' })).toMatchObject({
      state: 'working',
      rule: 'osc_title_working',
    });
  });

  it('codex: OSC "Action Required" blocks; braille title works; nothing matched → unknown', () => {
    expect(detectScreenState(codex, { screen: '', oscTitle: 'Action Required — codex' }).state).toBe('blocked');
    expect(detectScreenState(codex, { screen: '', oscTitle: '⠋ codex' }).state).toBe('working');
    expect(detectScreenState(codex, { screen: '› ' }).state).toBe('unknown');
  });

  it('opencode: permission banner blocks, interrupt hint works', () => {
    expect(detectScreenState(opencode, { screen: '△ Permission required\nbash: rm -rf /tmp/x' }).state).toBe('blocked');
    expect(detectScreenState(opencode, { screen: 'thinking…  esc to interrupt' }).state).toBe('working');
  });
});

describe('regions (herdr semantics)', () => {
  it('bottom_non_empty_lines / after_last_horizontal_rule / prompt_box_body', () => {
    const screen = 'a\n\nb\n──────\nc\n──────\nd\n';
    expect(extractRegion({ screen }, 'bottom_non_empty_lines(2)')).toBe('──────\nd\n');
    expect(extractRegion({ screen }, 'after_last_horizontal_rule')).toBe('d\n');
    expect(extractRegion({ screen }, 'prompt_box_body')).toBe('c');
    expect(extractRegion({ screen }, 'top_non_empty_lines(2)')).toBe('a\n\nb');
    expect(extractRegion({ screen, oscTitle: 't' }, 'osc_title')).toBe('t');
  });
});

describe('ScreenStateDetector over a headless terminal', () => {
  it('classifies rendered PTY output (ANSI, OSC title) and reports only changes', async () => {
    const changes: ScreenChange[] = [];
    const detector = new ScreenStateDetector({ manifest: claude, cols: 100, rows: 20, onChange: (c) => changes.push(c) });
    // colored, cursor-positioned output as a real TUI would draw it
    detector.write('\x1b[2J\x1b[H\x1b[1;36m⏺\x1b[0m Reading src/parser.ts\r\n\r\n');
    detector.write('\x1b[35m✻\x1b[0m Thinking… (3s · esc to interrupt)\r\n');
    expect((await detector.flush()).state).toBe('working');

    detector.write('\x1b[2J\x1b[H' + CLAUDE_BASH_PERMISSION.split('\n').join('\r\n'));
    expect((await detector.flush()).state).toBe('blocked');

    detector.write('\x1b[2J\x1b[H' + CLAUDE_IDLE.split('\n').join('\r\n'));
    expect((await detector.flush()).state).toBe('idle');
    await detector.flush(); // no change → no extra callback

    expect(changes.map((c) => `${c.previous}→${c.state}`)).toEqual([
      'unknown→working',
      'working→blocked',
      'blocked→idle',
    ]);
    expect(changes[1]?.rule).toBe('bash_permission_prompt');
    detector.dispose();
  });

  it('a local override manifest replaces the bundled one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-detect-'));
    fs.writeFileSync(
      path.join(dir, 'codex.toml'),
      'id = "codex"\n[[rules]]\nid = "custom"\nstate = "blocked"\ncontains = ["pineapple"]\n',
    );
    const custom = loadManifest('codex', dir)!;
    expect(detectScreenState(custom, { screen: 'PINEAPPLE time' })).toMatchObject({ state: 'blocked', rule: 'custom' });
    expect(() => parseManifest('rules = 3')).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
