// Update channels for the desktop app (P5.M6.T4), served with the site:
//   node scripts/update-manifests.mjs <pagesDir>
// updates/latest.json = the newest stable release's updater manifest,
// updates/next.json = the newest release's (release candidates included).
// Releases without a latest.json (no updater key yet) are skipped.
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(path.resolve(process.argv[2] ?? 'pages'), 'updates');
const headers = { accept: 'application/vnd.github+json', 'user-agent': 'aeos-site-build' };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const res = await fetch('https://api.github.com/repos/mirrorfolio-idea-labs/AEOS/releases?per_page=30', { headers, signal: AbortSignal.timeout(15000) });
if (!res.ok) throw new Error(`GitHub API ${res.status}`);
const releases = (await res.json()).filter((r) => !r.draft && r.assets.some((a) => a.name === 'latest.json'));
const channels = { latest: releases.find((r) => !r.prerelease), next: releases[0] };

fs.mkdirSync(out, { recursive: true });
for (const [channel, release] of Object.entries(channels)) {
  if (release === undefined) {
    console.log(`update-manifests: no release with an updater manifest for ${channel}`);
    continue;
  }
  const asset = release.assets.find((a) => a.name === 'latest.json');
  const body = await (await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(15000) })).text();
  JSON.parse(body); // must be a manifest, not an error page
  fs.writeFileSync(path.join(out, `${channel}.json`), body);
  console.log(`update-manifests: ${channel} → ${release.tag_name}`);
}
