#!/usr/bin/env node
// Tauri updater manifest for a release (P5.M6.T4):
//   node scripts/release/updater-manifest.mjs <dist-artifacts> <tag>
// Writes <dir>/latest.json from the signed update artifacts the desktop build
// produced (AppImage + .sig on Linux, .app.tar.gz + .sig on macOS). Without
// them (no signing key configured) it writes nothing and exits 0.
import fs from 'node:fs';
import path from 'node:path';

const [dir, tag] = process.argv.slice(2);
if (!dir || !tag) {
  console.error('usage: updater-manifest.mjs <dir> <tag>');
  process.exit(2);
}
const repo = process.env.GITHUB_REPOSITORY ?? 'mirrorfolio-idea-labs/AEOS';
const files = fs.readdirSync(dir);
const kinds = [
  { platform: 'linux-x86_64', artifact: (f) => f.endsWith('.AppImage') },
  { platform: 'darwin-aarch64', artifact: (f) => f.endsWith('.app.tar.gz') },
];

const platforms = {};
for (const kind of kinds) {
  const artifact = files.find((f) => kind.artifact(f) && files.includes(`${f}.sig`));
  if (artifact === undefined) continue;
  platforms[kind.platform] = {
    signature: fs.readFileSync(path.join(dir, `${artifact}.sig`), 'utf8').trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(artifact)}`,
  };
}
if (Object.keys(platforms).length === 0) {
  console.log('updater-manifest: no signed update artifacts (no updater key configured); skipping');
  process.exit(0);
}
const manifest = {
  version: tag.replace(/^v/, ''),
  notes: `https://github.com/${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};
fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`updater-manifest: latest.json for ${tag} (${Object.keys(platforms).join(', ')})`);
