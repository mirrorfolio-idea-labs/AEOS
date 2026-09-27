/**
 * Which desktop installer to offer (P5.M6.T1). Pure, so the OS-detection
 * accept criterion is unit-tested (test/installers.test.ts).
 */
export interface Asset {
  name: string;
  url: string;
  size: number;
}

export type Os = 'macos' | 'linux' | 'windows' | 'other';

export interface Installer {
  label: string;
  detail: string;
  asset: Asset;
}

/** From navigator.userAgent (and navigator.platform when present). */
export function detectOs(userAgent: string, platform = ''): Os {
  const ua = `${platform} ${userAgent}`.toLowerCase();
  if (/iphone|ipad|android/.test(ua)) return 'other';
  if (/mac/.test(ua)) return 'macos';
  if (/win/.test(ua)) return 'windows';
  if (/linux|x11|cros/.test(ua)) return 'linux';
  return 'other';
}

const kinds: Array<{ os: Os; test: (name: string) => boolean; label: string; detail: string }> = [
  { os: 'macos', test: (n) => n.endsWith('.dmg'), label: 'Download for macOS', detail: 'Apple silicon · .dmg' },
  { os: 'linux', test: (n) => n.endsWith('.AppImage'), label: 'Download for Linux', detail: 'Any distribution · AppImage' },
  { os: 'linux', test: (n) => n.endsWith('.deb'), label: 'Debian / Ubuntu', detail: '.deb package' },
  { os: 'linux', test: (n) => n.endsWith('.pkg.tar.zst'), label: 'Arch Linux', detail: 'pacman package · pacman -U' },
];

/** Installers for one OS, best first; empty when there is none (Windows: use WSL2). */
export function installersFor(os: Os, assets: readonly Asset[]): Installer[] {
  const out: Installer[] = [];
  for (const kind of kinds) {
    if (kind.os !== os) continue;
    const asset = assets.find((a) => kind.test(a.name));
    if (asset !== undefined) out.push({ label: kind.label, detail: kind.detail, asset });
  }
  return out;
}

/** Every desktop installer in a release, for the "other platforms" list. */
export function allInstallers(assets: readonly Asset[]): Installer[] {
  return (['macos', 'linux'] as const).flatMap((os) => installersFor(os, assets));
}

export function formatSize(bytes: number): string {
  return `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`;
}
