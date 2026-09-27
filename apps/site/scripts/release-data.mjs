// Build-time snapshot of the newest release that has desktop installers
// (P5.M6.T1). The page links straight to its assets; when GitHub is
// unreachable the page falls back to the Releases page instead of failing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'generated', 'release.json');
fs.mkdirSync(path.dirname(out), { recursive: true });

const installer = /\.(dmg|AppImage|deb|pkg\.tar\.zst)$/;
let data = null;
try {
  // tests pin the page to a known release instead of whatever is latest
  if (process.env.AEOS_SITE_RELEASE_FIXTURE) {
    data = JSON.parse(fs.readFileSync(process.env.AEOS_SITE_RELEASE_FIXTURE, 'utf8'));
    fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
    console.log(`release-data: fixture ${data.tag}`);
    process.exit(0);
  }
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'aeos-site-build' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch('https://api.github.com/repos/mirrorfolio-idea-labs/AEOS/releases?per_page=20', {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const releases = (await res.json()).filter((r) => !r.draft && r.assets.some((a) => installer.test(a.name)));
  // prefer the newest stable release; a pre-release only when nothing stable has installers yet
  const pick = releases.find((r) => !r.prerelease) ?? releases[0];
  if (pick) {
    data = {
      tag: pick.tag_name,
      url: pick.html_url,
      prerelease: pick.prerelease,
      assets: pick.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    };
  }
} catch (error) {
  console.warn(`release-data: ${error.message}; the page will link to the Releases page`);
}
fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(`release-data: ${data ? `${data.tag} (${data.assets.length} assets)` : 'none'}`);
