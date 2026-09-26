import { parse as parseToml } from 'smol-toml';

/** Screen-derived state (herdr vocabulary); `unknown` = no rule matched confidently. */
export type ScreenState = 'idle' | 'working' | 'blocked' | 'unknown';

export interface Gate {
  all?: Gate[];
  any?: Gate[];
  not?: Gate[];
  contains?: string[];
  regex?: string[];
  line_regex?: string[];
}

export interface Rule extends Gate {
  id: string;
  state?: ScreenState;
  priority?: number;
  region?: string;
  skip_state_update?: boolean;
}

export interface Manifest {
  id: string;
  version?: string;
  aliases?: string[];
  rules: Rule[];
}

interface CompiledGate {
  all: CompiledGate[];
  any: CompiledGate[];
  not: CompiledGate[];
  contains: string[];
  regex: RegExp[];
  lineRegex: RegExp[];
}

export interface CompiledRule {
  id: string;
  state: ScreenState;
  priority: number;
  region: string;
  skipStateUpdate: boolean;
  gate: CompiledGate;
}

export interface CompiledManifest {
  id: string;
  version: string | undefined;
  rules: CompiledRule[];
}

/** What the screen shows: rendered text plus the OSC title/progress side channels. */
export interface ScreenInput {
  screen: string;
  oscTitle?: string;
  oscProgress?: string;
}

export interface Detection {
  state: ScreenState;
  /** Matched rule id (explainability) — absent on fallback. */
  rule?: string;
  /** A matched `skip_state_update` rule: keep the previous state (e.g. transcript viewer). */
  skip: boolean;
}

/**
 * Translate a Rust `regex` pattern (herdr manifests) to a JS RegExp:
 * leading inline flags `(?ims)` become RegExp flags, `\x{HHHH}` becomes
 * `\u{HHHH}`, and the absolute anchors `\A` / `\z` become lookarounds so
 * they keep their meaning under the `m` flag.
 */
export function rustRegex(pattern: string): RegExp {
  let source = pattern;
  let flags = 'u';
  const inline = /^\(\?([ims]+)\)/.exec(source);
  if (inline?.[1] !== undefined) {
    for (const f of inline[1]) if (!flags.includes(f)) flags += f;
    source = source.slice(inline[0].length);
  }
  source = source
    .replace(/\\x\{([0-9A-Fa-f]+)\}/g, '\\u{$1}')
    .replace(/\\A/g, '(?<![\\s\\S])')
    .replace(/\\z/g, '(?![\\s\\S])');
  return new RegExp(source, flags);
}

function compileGate(gate: Gate): CompiledGate {
  return {
    all: (gate.all ?? []).map(compileGate),
    any: (gate.any ?? []).map(compileGate),
    not: (gate.not ?? []).map(compileGate),
    contains: (gate.contains ?? []).map((needle) => needle.toLowerCase()),
    regex: (gate.regex ?? []).map(rustRegex),
    lineRegex: (gate.line_regex ?? []).map(rustRegex),
  };
}

export function compileManifest(manifest: Manifest): CompiledManifest {
  return {
    id: manifest.id,
    version: manifest.version,
    rules: manifest.rules.map((rule) => ({
      id: rule.id,
      state: rule.state ?? 'unknown',
      priority: rule.priority ?? 0,
      region: (rule.region ?? 'whole_recent').trim(),
      skipStateUpdate: rule.skip_state_update === true,
      gate: compileGate(rule),
    })),
  };
}

export function parseManifest(toml: string): CompiledManifest {
  const raw = parseToml(toml) as unknown as Manifest;
  if (typeof raw.id !== 'string' || !Array.isArray(raw.rules)) {
    throw new Error('manifest needs an `id` and [[rules]]');
  }
  return compileManifest(raw);
}

/** herdr gate semantics: every contains/regex/line_regex/all must hold, one `any`, no `not`. */
function gateMatches(gate: CompiledGate, text: string, lower: string, lines: string[]): boolean {
  if (!gate.contains.every((needle) => lower.includes(needle))) return false;
  if (!gate.regex.every((re) => re.test(text))) return false;
  if (!gate.lineRegex.every((re) => lines.some((line) => re.test(line)))) return false;
  if (!gate.all.every((nested) => gateMatches(nested, text, lower, lines))) return false;
  if (gate.any.length > 0 && !gate.any.some((nested) => gateMatches(nested, text, lower, lines))) return false;
  if (gate.not.some((nested) => gateMatches(nested, text, lower, lines))) return false;
  return true;
}

// ── regions (line-based ports of herdr's region extractors) ─────────────

const isHorizontalRule = (line: string): boolean => {
  const trimmed = line.trim();
  const run = /^─+/.exec(trimmed)?.[0].length ?? 0;
  if (run === 0) return false;
  return trimmed.slice(run).trimStart() === '' || run >= 3;
};

const codexPromptLine = (line: string): boolean => line === '›' || line.startsWith('› ');
const codexBlockMarker = (line: string): boolean => /^[•■✗✓]/.test(line);

function currentCodexPromptIndex(lines: string[]): number | undefined {
  let index = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (codexPromptLine(lines[i] as string)) {
      index = i;
      break;
    }
  }
  if (index < 0) return undefined;
  return lines.slice(index + 1).some(codexBlockMarker) ? undefined : index;
}

function promptBoxTop(lines: string[]): number | undefined {
  let borders = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isHorizontalRule(lines[i] as string)) {
      borders += 1;
      if (borders === 2) return i;
    }
  }
  return undefined;
}

const joinLines = (lines: string[]): string => lines.join('\n');

export function extractRegion(input: ScreenInput, spec: string): string {
  if (spec === 'osc_title') return input.oscTitle ?? '';
  if (spec === 'osc_progress') return input.oscProgress ?? '';
  const content = input.screen;
  const lines = content.split('\n');
  const counted = /^(bottom_lines|bottom_non_empty_lines|top_non_empty_lines)\((\d+)\)$/.exec(spec);
  if (counted !== null) {
    const count = Number(counted[2]);
    if (counted[1] === 'bottom_lines') return joinLines(lines.slice(Math.max(0, lines.length - count)));
    const nonEmpty = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim() !== '');
    if (nonEmpty.length === 0 || count === 0) return '';
    if (counted[1] === 'bottom_non_empty_lines') {
      const start = nonEmpty[Math.max(0, nonEmpty.length - count)]?.[1] ?? 0;
      return joinLines(lines.slice(start));
    }
    const end = nonEmpty[Math.min(count, nonEmpty.length) - 1]?.[1] ?? 0;
    return joinLines(lines.slice(0, end + 1));
  }
  switch (spec) {
    case 'whole_recent':
      return content;
    case 'after_last_horizontal_rule': {
      let last = -1;
      lines.forEach((l, i) => {
        if (isHorizontalRule(l)) last = i;
      });
      return joinLines(lines.slice(last + 1));
    }
    case 'prompt_box_body': {
      const top = promptBoxTop(lines);
      if (top === undefined) return '';
      const rest = lines.slice(top + 1);
      const end = rest.findIndex(isHorizontalRule);
      return joinLines(end < 0 ? rest : rest.slice(0, end));
    }
    case 'above_prompt_box': {
      const top = promptBoxTop(lines);
      return top === undefined ? content : joinLines(lines.slice(0, top));
    }
    case 'last_non_empty_above_prompt_box': {
      const top = promptBoxTop(lines);
      const above = top === undefined ? lines : lines.slice(0, top);
      return [...above].reverse().find((l) => l.trim() !== '') ?? '';
    }
    case 'after_last_prompt_marker': {
      let index = -1;
      lines.forEach((l, i) => {
        if (codexPromptLine(l)) index = i;
      });
      return index < 0 ? content : joinLines(lines.slice(index + 1));
    }
    case 'before_current_prompt_marker': {
      const index = currentCodexPromptIndex(lines);
      return index === undefined ? content : joinLines(lines.slice(0, index)) + (index > 0 ? '\n' : '');
    }
    case 'whole_recent_without_current_prompt_marker':
      return currentCodexPromptIndex(lines) === undefined ? content : '';
    default:
      return '';
  }
}

/**
 * Evaluate a manifest against one screen: the highest-priority matching
 * rule wins (ties keep the earlier rule, as in herdr). No match → the
 * fallback state (`unknown` — a quiet screen is not proof of idleness).
 */
export function detect(manifest: CompiledManifest, input: ScreenInput, fallback: ScreenState = 'unknown'): Detection {
  let best: CompiledRule | undefined;
  for (const rule of manifest.rules) {
    const text = extractRegion(input, rule.region);
    if (!gateMatches(rule.gate, text, text.toLowerCase(), text.split('\n'))) continue;
    if (best === undefined || rule.priority > best.priority) best = rule;
  }
  if (best === undefined) return { state: fallback, skip: false };
  return { state: best.state, rule: best.id, skip: best.skipStateUpdate };
}
