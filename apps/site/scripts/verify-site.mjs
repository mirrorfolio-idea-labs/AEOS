// P5.M6.T1 accept, in a real browser:
//   node scripts/verify-site.mjs <pagesDir> [--external]
// Serves the assembled Pages tree (site + docs/) under the site base and
// loads the landing page as a macOS and as a Linux visitor:
//   - the primary download button offers that OS's installer (.dmg /
//     .AppImage) whenever the built-in release data has one;
//   - every rendered link and image resolves: pages and files under the
//     base must exist, in-page anchors must exist, and with --external
//     every outside link must answer (retrying, 429 counts as up).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { fileFor as fileForIn, serve } from './serve.mjs';

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'pages');
const external = args.includes('--external');
const BASE = (process.env.AEOS_SITE_BASE ?? '/AEOS/').replace(/\/?$/, '/');
const release = JSON.parse(fs.readFileSync(new URL('../src/generated/release.json', import.meta.url), 'utf8'));

const { origin, close } = await serve(root, BASE);
const fileFor = (urlPath) => fileForIn(root, BASE, urlPath);

const visitors = {
  macos: { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', installer: /\.dmg$/ },
  linux: { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', installer: /\.AppImage$/ },
};

const failures = [];
const links = new Set();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE; // e.g. a preinstalled Chromium
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const [os, visitor] of Object.entries(visitors)) {
    const page = await (await browser.newContext({ userAgent: visitor.ua })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${origin}${BASE}`, { waitUntil: 'networkidle' });
    if (errors.length > 0) failures.push(`${os}: page errors: ${errors.join('; ')}`);

    const expected = release?.assets.find((a) => visitor.installer.test(a.name));
    const primary = page.locator('#install a', { hasText: /^Download for/ }).first();
    if (expected !== undefined) {
      const href = (await primary.count()) > 0 ? await primary.getAttribute('href') : null;
      if (href !== expected.url) failures.push(`${os}: primary download is ${href}, expected ${expected.url}`);
      else console.log(`verify-site: ${os} visitor is offered ${expected.name}`);
    } else {
      console.log(`verify-site: ${os}: no ${visitor.installer} in the release data; the page links to Releases`);
    }

    const found = await page.evaluate(() => ({
      urls: [
        ...[...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
        ...[...document.querySelectorAll('img[src]')].map((i) => i.getAttribute('src')),
      ],
      ids: [...document.querySelectorAll('[id]')].map((e) => e.id),
    }));
    for (const url of found.urls) {
      if (url.startsWith('#')) {
        if (!found.ids.includes(url.slice(1))) failures.push(`missing anchor ${url}`);
      } else links.add(url);
    }
    // the install command is a link too: the installer must be served
    const command = await page.locator('#install code', { hasText: 'install.sh' }).first().textContent();
    const script = /https:\/\/[^\s]+install\.sh/.exec(command ?? '')?.[0];
    if (script !== undefined) links.add(script);
  }
} finally {
  await browser.close();
  close();
}

const outside = [];
for (const url of links) {
  const local = url.startsWith('https://mirrorfolio-idea-labs.github.io') ? url.slice('https://mirrorfolio-idea-labs.github.io'.length) : url;
  if (local.startsWith('/')) {
    if (fileFor(local.split('#')[0]) === undefined) failures.push(`missing ${url}`);
  } else if (/^https?:/.test(url)) outside.push(url);
}
if (external) {
  for (const url of outside) {
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) });
        ok = res.ok || res.status === 429;
      } catch {}
      if (!ok) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!ok) failures.push(`unreachable ${url}`);
  }
}

if (failures.length > 0) {
  console.error(`verify-site: ${failures.length} problem(s)\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`verify-site: ${links.size} links (${outside.length} external${external ? ', fetched' : ', not fetched'}) all resolve`);
