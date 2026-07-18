# ADR-001 — License: MIT

- **Status:** accepted
- **Date:** 2026-07-18
- **Task:** AEOS-P5.M1.T1

## Context

AEOS is built to be a public, contributor-friendly open-source project
(Phase P5 exit gate). The license must:

1. Maximize adoption — AEOS is infrastructure (a daemon + SDK + UI) that
   users embed into their own workflows and companies; friction kills
   adoption of infrastructure.
2. Allow a healthy plugin ecosystem (spec §15): third-party plugins,
   including commercial/closed ones, must be able to link against
   `@aeos/contracts` and the plugin API without licensing entanglement.
3. Keep the door open for the maintainers to offer hosted or commercial
   distributions later without relicensing contributions.
4. Be instantly recognizable so corporate contributors don't need legal
   review to participate.

## Options considered

- **MIT** — maximally permissive, universally understood, plugin-friendly.
- **Apache-2.0** — permissive with an explicit patent grant; slightly more
  ceremony (NOTICE handling, longer header). A strong second choice.
- **AGPL-3.0** — protects against closed-source SaaS forks, but would deter
  the commercial plugin ecosystem and most corporate adoption.

## Decision

**MIT**, applied to the whole monorepo and every published package.

Rationale: the strategic bet is ecosystem growth over fork protection.
AEOS's moat is the contracts ABI, the conformance suites, and the community —
not the source itself. MIT's simplicity best serves goals 1–4. If patent
concerns materialize as the project grows, relicensing new versions under
Apache-2.0 remains possible (MIT → Apache-2.0 adds restrictions only for
future code; existing grants stand).

## Consequences

- `LICENSE` (MIT) at the repo root; every `package.json` declares
  `"license": "MIT"`.
- Dependencies must stay MIT-compatible: no copyleft (GPL/AGPL) runtime
  dependencies. Verified via `pnpm licenses list` (AEOS-P5.M1.T3 automates
  the transitive audit).
- Third-party plugins may use any license, including proprietary.
