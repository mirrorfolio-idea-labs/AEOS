// AEOS docs site (P5.M2). Content is GENERATED from the repository's own
// docs by scripts/sync-docs.mjs — docs/ stays the single source of truth.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const site = process.env.AEOS_DOCS_SITE ?? 'https://mirrorfolio-idea-labs.github.io';
const base = process.env.AEOS_DOCS_BASE ?? '/AEOS';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'AEOS',
      description: 'Durable, resumable AI coding agents whose entire state lives as files.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mirrorfolio-idea-labs/AEOS' }],
      editLink: { baseUrl: 'https://github.com/mirrorfolio-idea-labs/AEOS/edit/main/' },
      sidebar: [
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        {
          label: 'Architecture',
          items: [
            { label: 'System design', link: '/architecture/design/' },
            { label: 'Decision records', collapsed: true, items: [{ autogenerate: { directory: 'architecture/adr' } }] },
          ],
        },
        { label: 'Project', items: [{ autogenerate: { directory: 'project' } }] },
      ],
    }),
  ],
});
