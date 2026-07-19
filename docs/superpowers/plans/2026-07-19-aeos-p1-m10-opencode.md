# AEOS P1.M10 — OpenCode Adapter (hermetic) — Implementation Plan

> **Cold-start brief.** Pulled forward from P2.M6 by scope decision
> 2026-07-19 (second harness in v0.1; Codex stays in P2). Provider ABI and
> conformance suite exist from M4 (`@aeos/provider-core`); this milestone
> mirrors the `provider-claude` package shape. Branch
> `feat/aeos-p1-m10-opencode` from `main`. No live calls in tests —
> fixtures + injectable child seam; live smoke behind `AEOS_LIVE_SMOKE=1`
> with an operator guide in `guides/`.

## Global constraints

- Package `packages/provider-opencode`; may depend on `@aeos/contracts` +
  `@aeos/provider-core` entry points only.
- Credential model reused from M4 including multi-account subscription
  slots: for OpenCode, a subscription slot maps to a persistent
  `XDG_DATA_HOME` (OpenCode keeps `auth.json` in its data dir) while
  config/state/cache stay per-agent.
- Fixture provenance: hand-authored to OpenCode's documented event shapes
  initially; `scripts/record-fixture.sh` re-records from a real run at the
  live smoke (same deviation protocol as M4, cleared at exit).

### Task 1: Hermetic profile builder  `[AEOS-P1.M10.T1]`
`src/profile.ts` — per-agent homes under `<agent>/harness/opencode/`
(`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`) +
`OPENCODE_DISABLE_PROJECT_CONFIG=1`; generated
`config/opencode/opencode.json` from feature toggles; credential env per
kind (api-key → `ANTHROPIC_API_KEY`; gateway → base-url + token env;
subscription → slot data-home + passthrough markers).
*Accept: no `$HOME`/default-XDG refs; different slots isolate; toggles round-trip.*

### Task 2: Spawn/stream/translate + resume  `[AEOS-P1.M10.T2]`
`src/translate.ts` + `src/adapter.ts` — argv `opencode run <objective>
--format json` (+ `--session <id>` resume); translate the event stream
(`message.part.updated` text/tool parts, `message.updated` assistant cost,
`session.idle`/`session.error`) into canonical events; unknown lines
counted, never fatal; cost.usage tagged with credential profile id.
*Accept: golden fixtures translate byte-identically; resume fixture continues an objective.*

### Task 3: Conformance  `[AEOS-P1.M10.T3]`
Run `describeAdapterConformance` over the OpenCode adapter with
fixture-driven `RunChild`; add the shared-fixture objective parity check.
*Accept: conformance green alongside claude + fake.*

## Exit gate
Same fixture objective completes on fake, Claude, and OpenCode adapters;
live smoke (manual, budget-capped) recorded via operator guide.
