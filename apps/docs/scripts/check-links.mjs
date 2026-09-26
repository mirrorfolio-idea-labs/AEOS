#!/usr/bin/env node
// Broken-link check over the BUILT site (P5.M2.T1 accept): every internal
// href/src must resolve to a built file, and every #anchor to an id on the
// target page. External links are not fetched (CI must not depend on them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const BASE = (process.env.AEOS_DOCS_BASE ?? '/AEOS').replace(/\/$/, '');
const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) pages.push(p);
  }
})(DIST);

const idsCache = new Map();
const idsOf = (file) => {
  if (!idsCache.has(file)) idsCache.set(file, new Set([...fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return idsCache.get(file);
};
function resolveTarget(urlPath) {
  const rel = decodeURIComponent(urlPath.startsWith(BASE + '/') || urlPath === BASE ? urlPath.slice(BASE.length) : urlPath);
  const base = path.join(DIST, rel);
  for (const c of [base, path.join(base, 'index.html'), `${base}.html`]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return undefined;
}

const broken = [];
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const link = m[1].replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|data:|javascript:)/.test(link)) continue;
    const [p, anchor] = link.split('#');
    const target = p === '' ? page : p.startsWith('/') ? resolveTarget(p) : resolveTarget(path.posix.join(path.posix.dirname('/' + path.relative(DIST, page)), p));
    if (target === undefined) {
      broken.push(`${path.relative(DIST, page)} → ${link}`);
      continue;
    }
    if (anchor !== undefined && anchor !== '' && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(anchor))) {
      broken.push(`${path.relative(DIST, page)} → ${link} (missing #${anchor})`);
    }
  }
}
if (broken.length > 0) {
  console.error(`check-links: ${String(broken.length)} broken link(s):\n  ${[...new Set(broken)].join('\n  ')}`);
  process.exit(1);
}
console.log(`check-links: ${String(pages.length)} pages, all internal links and anchors resolve`);
