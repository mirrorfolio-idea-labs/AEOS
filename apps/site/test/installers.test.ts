import { describe, expect, it } from 'vitest';
import { allInstallers, detectOs, installersFor, type Asset } from '../src/installers.js';

const asset = (name: string): Asset => ({ name, url: `https://example.test/${name}`, size: 1 });
const release = [
  'aeos-1.0.0-linux-x64.tar.gz',
  'aeos-1.0.0-linux-x64.tar.gz.sigstore.json',
  'AEOS_1.0.0_aarch64.dmg',
  'AEOS_1.0.0_amd64.AppImage',
  'AEOS_1.0.0_amd64.deb',
  'aeos-1.0.0rc1-1-x86_64.pkg.tar.zst',
  'AEOS_1.0.0_amd64.deb.spdx.json',
  'SHA256SUMS',
].map(asset);

describe('landing page installer choice (P5.M6.T1)', () => {
  it('detects the visitor OS from real user agents', () => {
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15', 'MacIntel')).toBe('macos');
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0', 'Linux x86_64')).toBe('linux');
    expect(detectOs('Mozilla/5.0 (X11; Arch Linux; rv:128.0) Gecko/20100101 Firefox/128.0')).toBe('linux');
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Win32')).toBe('windows');
    expect(detectOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', 'iPhone')).toBe('other');
    expect(detectOs('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l')).toBe('other');
  });

  it('offers the dmg on macOS, and AppImage first then deb and Arch on Linux', () => {
    expect(installersFor('macos', release).map((i) => i.asset.name)).toEqual(['AEOS_1.0.0_aarch64.dmg']);
    expect(installersFor('linux', release).map((i) => i.asset.name)).toEqual([
      'AEOS_1.0.0_amd64.AppImage',
      'AEOS_1.0.0_amd64.deb',
      'aeos-1.0.0rc1-1-x86_64.pkg.tar.zst',
    ]);
  });

  it('never offers signatures, SBOMs, checksums or CLI bundles as installers, and nothing on Windows', () => {
    const names = allInstallers(release).map((i) => i.asset.name);
    expect(names).not.toContain('AEOS_1.0.0_amd64.deb.spdx.json');
    expect(names).not.toContain('SHA256SUMS');
    expect(names).not.toContain('aeos-1.0.0-linux-x64.tar.gz');
    expect(installersFor('windows', release)).toEqual([]);
  });
});
