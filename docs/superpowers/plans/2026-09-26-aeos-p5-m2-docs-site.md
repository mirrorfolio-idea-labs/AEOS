# AEOS P5.M2 — Docs Site + Onboarding

## Design
- **Site.** `apps/docs` runs Astro + Starlight (pre-approved). `docs/` stays
  the only source of truth; `scripts/sync-docs.mjs` renders it into
  `src/content/docs`, which is gitignored:
  - The page map covers the quickstart, first-agent, deploy, plugins, the
    architecture spec, ADRs, roadmap, release process, contributing and
    security.
  - Titles come from each page's first heading. Edit links point to the
    repo.
  - Relative links are rewritten. Site pages become site URLs; everything
    else, including raw HTML `href`/`src`, becomes a GitHub URL, and
    images go to raw GitHub.
  - The **ADR index is generated** from `docs/adr/`, with titles and
    status.
- **Checks.**
  - `scripts/check-links.mjs` runs after `astro build`. Every internal
    href/src must resolve to a built file, and every `#anchor` to an id on
    the target page. External links are not fetched.
  - It proved itself on the first build: it caught a missing favicon and
    README raw-HTML links.
- **CI and deploy.**
  - The `docs-site` job runs on PRs.
  - `docs-pages.yml` deploys to Pages on pushes to main. Enabling Pages is
    a one-time maintainer step.
  - The root `pnpm build` skips the site, which has its own job.
- **T2 content.**
  - `docs/getting-started/quickstart.md`.
  - `docs/getting-started/first-agent.md`. Its `tutorial:run` blocks are
    **executed by CI** (`apps/cli/test/tutorial.test.ts`) against a fresh
    daemon, with a background "human" approving parked requests, as the
    reader would in the UI.
  - `docs/deploy.md` already has one quickstart per target.
- **T4 assets.** `pnpm -F @aeos/docs demo:assets` boots a throwaway daemon
  on the demo provider and drives the golden path. It writes three ADE
  screenshots (session / approvals / review) and an asciicast v2 of the CLI
  run to `docs/assets/`, and the README embeds them.

## Found while writing the tutorial (all fixed in this PR)
- The CLI had no way to see or answer approvals; the inbox was UI-only.
  Added `aeos approvals [list] | approve | deny`.
- `aeos objective run` polled silently while parked. It now prints each
  request once with the command that answers it, and exits 4 when a
  proposal waits outside the inbox.
- Planner sessions were never registered, and plan-approval events carried
  a synthetic session id, so TranscriptRoutingError still fired (follow-up
  to #130). The planner now goes through `recordSession`, and plan
  approvals are objective-scoped (`taskId: plan`).

## Verification
- `pnpm -F @aeos/docs build`: 21 pages; all internal links and anchors
  resolve.
- `tutorial.test.ts`: every tutorial command exits as documented. The
  daemon logs no routing errors and no errored runs.
- **Manual:** the blind newcomer test (T2 accept). A guide is in
  `guides/`.
