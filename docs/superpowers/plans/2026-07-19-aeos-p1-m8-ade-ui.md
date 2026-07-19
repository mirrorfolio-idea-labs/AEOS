# AEOS P1.M8 — ADE Minimal Web UI — Implementation Plan

> **Cold-start brief.** Spec §14 + `mockup.png`. App `apps/ade`
> (`@aeos/ade`): React + Vite + TypeScript, consuming `@aeos/sdk` only.
> Branch `feat/aeos-p1-m8-ade-ui`. Playwright (chromium) drives every
> accept; CI installs the browser. Daemon static-serving of the built UI
> is M9 wiring — M8 tests run against a harness that serves `dist/` +
> the API (provider-fake) from one process.

## Decisions

- No CSS framework — one `app.css` with the mockup's dark layout
  (sidebar = workspaces/agents, main = tabbed agent view).
- Session console v0 renders the SSE event stream as a terminal-styled
  log pane (monospace, autoscroll). xterm.js becomes worthwhile with PTY
  attach (P2.M5) — v0 keeps the dependency out; noted vs the ROADMAP
  line as an R4 deviation.
- Cost meter sums `cost.usage` events live; the API's objective runner
  also appends every `cost.usage` to `<objectiveDir>/costs.ndjson`
  (files as truth for the T4 accept).
- Playwright config boots `test/harness.mjs` (API server with
  provider-fake + `@fastify/static` serving the built UI on one port).

### Task 1  `[AEOS-P1.M8.T1]` Shell + routing + SDK wiring + sidebar
Vite scaffold, sidebar listing workspaces→agents with create forms,
main-pane routing. *Accept: Playwright creates workspace + agent via UI.*

### Task 2  `[AEOS-P1.M8.T2]` Conversation + live session console
Objective composer (title + tasks) + run button; live event console
streaming `/v1/events` through the SDK reader. *Accept: Playwright sees
streamed provider-fake output.*

### Task 3  `[AEOS-P1.M8.T3]` Agent files browser + plan viewer
Memory index/file browser, plan/checkpoint status table. *Accept:
Playwright opens a memory file and reads plan status.*

### Task 4  `[AEOS-P1.M8.T4]` BYOK switch + cost meter
Credential-profile switch control + per-objective cost meter. *Accept:
switch visible in UI state and cost.usage rows land in costs.ndjson.*

## Exit gate
Playwright suite green in CI (chromium).
