#!/usr/bin/env node
// Render the repository's docs into Starlight content (P5.M2.T1/T3).
// docs/ (and the root README/CONTRIBUTING/SECURITY) stay the ONLY source of
// truth: this script copies them into src/content/docs (gitignored),
// derives titles from their first heading, rewrites links (site pages →
// site URLs, everything else → GitHub), and generates the ADR index.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const OUT = path.resolve(HERE, '..', 'src', 'content', 'docs');
const REPO = 'https://github.com/mirrorfolio-idea-labs/AEOS';
const BASE = (process.env.AEOS_DOCS_BASE ?? '/AEOS/docs').replace(/\/$/, '');

/** source (repo-relative) → site slug (no extension), in sidebar order. */
const PAGES = [
  ['docs/getting-started/install.md', 'getting-started/install', 1],
  ['docs/getting-started/quickstart.md', 'getting-started/quickstart', 2],
  ['docs/getting-started/first-agent.md', 'getting-started/first-agent', 3],
  ['docs/deploy.md', 'guides/deploy', 1],
  ['docs/plugins.md', 'guides/plugins', 2],
  ['docs/compatibility.md', 'guides/compatibility', 3],
  ['docs/reference/cli.md', 'reference/cli', 1],
  ['docs/reference/api.md', 'reference/api', 2],
  ['docs/superpowers/specs/2026-07-12-aeos-architecture-design.md', 'architecture/design', 1],
  ['docs/ROADMAP.md', 'project/roadmap', 1],
  ['docs/RELEASE.md', 'project/release-process', 2],
  ['CONTRIBUTING.md', 'project/contributing', 3],
  ['SECURITY.md', 'project/security', 4],
];
const adrs = fs
  .readdirSync(path.join(ROOT, 'docs', 'adr'))
  .filter((f) => /^ADR-\d+.*\.md$/.test(f))
  .sort();
for (const f of adrs) PAGES.push([`docs/adr/${f}`, `architecture/adr/${f.replace(/\.md$/, '').toLowerCase()}`, 10]);

const existing = PAGES.filter(([src]) => fs.existsSync(path.join(ROOT, src)));
const slugOf = new Map(existing.map(([src, slug]) => [src, slug]));

/** Repo-relative path → the URL a reader should land on (site page, or GitHub). */
function urlFor(src, target, image) {
  const [file, anchor] = target.split('#');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(src), file));
  const hash = anchor === undefined ? '' : `#${anchor}`;
  const slug = slugOf.get(resolved);
  if (slug !== undefined && !image) return `${BASE}/${slug}/${hash}`;
  const isDir = fs.existsSync(path.join(ROOT, resolved)) && fs.statSync(path.join(ROOT, resolved)).isDirectory();
  return image ? `https://raw.githubusercontent.com/mirrorfolio-idea-labs/AEOS/main/${resolved}` : `${REPO}/${isDir ? 'tree' : 'blob'}/main/${resolved}${hash}`;
}

function rewriteLinks(markdown, src) {
  const dir = path.posix.dirname(src);
  // raw HTML in markdown (README badges/nav): href/src attributes too
  markdown = markdown.replace(/\s(href|src)="(?!https?:|mailto:|#|data:)([^"]+)"/g, (_w, attr, target) => ` ${attr}="${urlFor(src, target, attr === 'src')}"`);
  return markdown.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (whole, bang, text, target, title) => {
    if (/^(https?:|mailto:|#)/.test(target)) return whole;
    const [file, anchor] = target.split('#');
    const resolved = path.posix.normalize(path.posix.join(dir, file));
    const hash = anchor === undefined ? '' : `#${anchor}`;
    const slug = slugOf.get(resolved);
    if (slug !== undefined && bang === '') return `${bang}[${text}](${BASE}/${slug}/${hash}${title})`;
    const isDir = fs.existsSync(path.join(ROOT, resolved)) && fs.statSync(path.join(ROOT, resolved)).isDirectory();
    const url = bang === '!' ? `https://raw.githubusercontent.com/mirrorfolio-idea-labs/AEOS/main/${resolved}` : `${REPO}/${isDir ? 'tree' : 'blob'}/main/${resolved}${hash}`;
    return `${bang}[${text}](${url}${title})`;
  });
}

function toPage(src, slug, order) {
  let body = fs.readFileSync(path.join(ROOT, src), 'utf8');
  const h1 = /^#\s+(.+)$/m.exec(body);
  const title = (h1?.[1] ?? path.basename(slug)).replace(/`/g, '').trim();
  if (h1 !== null) body = body.replace(h1[0], '');
  body = rewriteLinks(body, src);
  // P5.M6.T2: `<!-- aeos:component Name -->` mounts a React island from
  // src/components/Name.tsx; such a page is emitted as MDX (so it must be
  // MDX-safe Markdown). Every other page stays plain .md.
  // only a marker alone on its line counts (a mention in prose or `code` does not)
  const components = [...new Set([...body.matchAll(/^<!--\s*aeos:component\s+([A-Z]\w*)\s*-->\s*$/gm)].map((m) => m[1]))];
  for (const name of components) {
    if (!fs.existsSync(path.resolve(HERE, '..', 'src', 'components', `${name}.tsx`))) throw new Error(`${src}: unknown component ${name}`);
    body = body.replace(new RegExp(`^<!--\\s*aeos:component\\s+${name}\\s*-->\\s*$`, 'gm'), `<${name} client:load />`);
  }
  // `<` followed by a non-tag char and `{` are fine in .md; strip HTML comments (tutorial markers)
  body = body.replace(/<!--[\s\S]*?-->\n?/g, '');
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `editUrl: ${JSON.stringify(`${REPO}/edit/main/${src}`)}`,
    `sidebar: { order: ${String(order)} }`,
    '---',
    '',
    ...components.map((name) => `import ${name} from '${path.relative(path.dirname(path.join(OUT, slug)), path.resolve(HERE, '..', 'src', 'components', name + '.tsx')).split(path.sep).join('/')}';\n\n`),
  ].join('\n');
  const file = path.join(OUT, `${slug}.${components.length > 0 ? 'mdx' : 'md'}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, frontmatter + body.replace(/^\s+/, ''));
  return title;
}

fs.rmSync(OUT, { recursive: true, force: true });
const adrRows = [];
for (const [src, slug, order] of existing) {
  const title = toPage(src, slug, order);
  if (src.startsWith('docs/adr/')) {
    const text = fs.readFileSync(path.join(ROOT, src), 'utf8');
    const status = /\*\*Status:?\*\*:?\s*([^\n]+)|^Status:\s*([^\n]+)/im.exec(text);
    adrRows.push(`| [${title}](${BASE}/${slug}/) | ${(status?.[1] ?? status?.[2] ?? '—').trim()} |`);
  }
}

// T3: the ADR index is generated, never hand-maintained
fs.mkdirSync(path.join(OUT, 'architecture', 'adr'), { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'architecture', 'adr', 'index.md'),
  ['---', 'title: Architecture decision records', 'sidebar: { order: 2 }', '---', '', 'Every architecturally significant decision, generated from `docs/adr/`.', '', '| Decision | Status |', '|---|---|', ...adrRows, ''].join('\n'),
);

// landing page: the README, minus its own title
const readme = rewriteLinks(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), 'README.md').replace(/^#\s+.+$/m, '').replace(/<!--[\s\S]*?-->\n?/g, '');
fs.writeFileSync(
  path.join(OUT, 'index.md'),
  ['---', 'title: AEOS', 'description: Durable, resumable AI coding agents whose entire state lives as files.', 'tableOfContents: false', '---', '', readme.replace(/^\s+/, '')].join('\n'),
);
console.log(`sync-docs: ${String(existing.length + 2)} pages (${String(adrs.length)} ADRs) → ${path.relative(ROOT, OUT)}`);

// P5.M6.T3: the one-line installer is served from the site root
// (…/AEOS/install.sh); scripts/install/install.sh stays its only source
fs.copyFileSync(path.join(ROOT, 'scripts', 'install', 'install.sh'), path.resolve(HERE, '..', 'public', 'install.sh'));
