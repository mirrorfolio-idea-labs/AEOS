// The GitHub Pages tree: the landing page at the root, the docs site under
// /docs/. Usage: node scripts/assemble-pages.mjs <outDir>  (after both builds)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPS = path.resolve(HERE, '..', '..');
const out = path.resolve(process.argv[2] ?? path.join(APPS, 'site', 'pages'));

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(APPS, 'site', 'dist'), out, { recursive: true });
fs.cpSync(path.join(APPS, 'docs', 'dist'), path.join(out, 'docs'), { recursive: true });
console.log(`assemble-pages: ${path.relative(process.cwd(), out)} (site + docs/)`);
