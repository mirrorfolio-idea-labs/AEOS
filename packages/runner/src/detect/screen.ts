import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xterm from '@xterm/headless';
import { detect, parseManifest, type CompiledManifest, type Detection, type ScreenState } from './rules.js';

const { Terminal } = xterm;

/** Harness → bundled manifest file (herdr names claude-code `claude`). */
const MANIFEST_NAMES: Readonly<Record<string, string>> = {
  'claude-code': 'claude',
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
};

/** `<pkg>/manifests` — resolves identically from `src/detect` and `dist/detect`. */
export const BUNDLED_MANIFEST_DIR = fileURLToPath(new URL('../../manifests/', import.meta.url));

/**
 * Load the detection manifest for a harness: a local override in
 * `overrideDir/<name>.toml` (e.g. `<AEOS_HOME>/agent-detection`) replaces
 * the bundled one wholesale, matching herdr's override convention.
 * Unknown harness → `undefined` (no screen detection).
 */
export function loadManifest(harness: string, overrideDir?: string): CompiledManifest | undefined {
  const name = MANIFEST_NAMES[harness];
  if (name === undefined) return undefined;
  const override = overrideDir === undefined ? undefined : path.join(overrideDir, `${name}.toml`);
  const file = override !== undefined && fs.existsSync(override) ? override : path.join(BUNDLED_MANIFEST_DIR, `${name}.toml`);
  return parseManifest(fs.readFileSync(file, 'utf8'));
}

export interface ScreenChange extends Detection {
  previous: ScreenState;
}

export interface ScreenDetectorOptions {
  manifest: CompiledManifest;
  cols?: number;
  rows?: number;
  /** Fires only when the classified state actually changes. */
  onChange?: (change: ScreenChange) => void;
  /** Evaluation throttle after output (herdr polls every 300 ms). */
  intervalMs?: number;
}

/**
 * Screen-state detection for interactive PTY sessions (P2.M10.T1, herdr
 * idea): PTY bytes feed a headless xterm, whose rendered bottom-of-buffer
 * text plus OSC title/progress are classified by the harness manifest.
 * Reads the live buffer, never a scrolled viewport — the same guarantee
 * herdr documents.
 */
export class ScreenStateDetector {
  private readonly terminal: InstanceType<typeof Terminal>;
  private oscTitle = '';
  private oscProgress = '';
  private state: ScreenState = 'unknown';
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly opts: ScreenDetectorOptions) {
    this.terminal = new Terminal({
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 40,
      allowProposedApi: true,
      scrollback: 200,
    });
    this.terminal.onTitleChange((title) => {
      this.oscTitle = title;
    });
    // OSC 9;4 — ConEmu/Windows-Terminal progress, which Claude Code emits
    this.terminal.parser.registerOscHandler(9, (data) => {
      if (data.startsWith('4;')) this.oscProgress = data;
      return true;
    });
  }

  get current(): ScreenState {
    return this.state;
  }

  write(data: string): void {
    this.terminal.write(data, () => this.schedule());
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  /** Resolve once all written data is parsed, then classify immediately. */
  flush(): Promise<Detection> {
    return new Promise((resolve) => {
      this.terminal.write('', () => resolve(this.evaluate()));
    });
  }

  /** Rendered text of the live screen (bottom of the active buffer). */
  screenText(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < this.terminal.rows; y += 1) {
      lines.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? '');
    }
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
    return lines.join('\n');
  }

  evaluate(): Detection {
    const detection = detect(this.opts.manifest, {
      screen: this.screenText(),
      oscTitle: this.oscTitle,
      oscProgress: this.oscProgress,
    });
    if (!detection.skip && detection.state !== this.state) {
      const previous = this.state;
      this.state = detection.state;
      this.opts.onChange?.({ ...detection, previous });
    }
    return detection;
  }

  private schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.evaluate();
    }, this.opts.intervalMs ?? 300);
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.terminal.dispose();
  }
}
