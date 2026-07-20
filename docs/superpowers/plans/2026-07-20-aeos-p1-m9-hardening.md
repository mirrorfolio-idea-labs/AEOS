# AEOS P1.M9 — Golden-path E2E + Hardening — Implementation Plan

> **Cold-start brief.** Spec §18. The last P1 milestone: prove the phase
> exit gate as an automated test, wire `aeosd` into the full product
> (API + UI + resume-on-boot), add the kill switch, ship docs and tag
> v0.1.0. Branch `feat/aeos-p1-m9-hardening`.

## Decisions

- The daemon mounts `@aeos/api` (port `AEOS_PORT`, default 7777, loopback;
  token via `AEOS_API_TOKEN`) and serves the built ADE UI when
  `apps/ade/dist` exists (`AEOS_UI_DIR` overrides).
- Provider selection: `AEOS_PROVIDER=fake|claude-code|opencode` (default
  per-agent from `agent.yaml`; `fake` forced by the E2E). Credentials v0:
  `ANTHROPIC_API_KEY` env → an `api-key` profile; subscription slots root
  at `<AEOS_HOME>/subscriptions` (secret store proper is P2.M3).
- Resume-on-boot: after mount, the daemon scans every agent's
  `objectives/` and restarts any plan with incomplete, unblocked tasks —
  the scheduler is file-derived so this is idempotent.
- Kill switch: `<AEOS_HOME>/STOP`. The scheduler checks it before every
  session spawn (pauses the objective); the API refuses new starts (409)
  while present; `POST/DELETE /v1/stop` + `aeos stop --all` /
  `aeos resume-ops` control it. Runner-level STOP handling shipped in M3.
- E2E (T1): spawns the real `aeosd` binary, drives it via the SDK,
  `SIGKILL`s it mid-objective, restarts, and expects file-derived resume
  to complete the plan. 10 consecutive cycles in one CI test = the flake
  gate. Uses provider-fake; the REAL-harness form is the T2 nightly
  (needs Kabeer's API key — deferred to guides/, R4).
- T4: README rewrite (quickstart), ADR-002…ADR-008 for locked decisions
  D1–D7, `v0.1.0` tag + GitHub pre-release.

## Tasks
- T1 `[AEOS-P1.M9.T1]` daemon wiring + golden-path E2E ×10.
- T2 `[AEOS-P1.M9.T2]` nightly live workflow (secret-gated) + operator guide.
- T3 `[AEOS-P1.M9.T3]` STOP kill switch across scheduler/API/CLI.
- T4 `[AEOS-P1.M9.T4]` README + ADRs + v0.1.0 tag.

## Exit gate = P1 exit gate
Golden-path E2E green in CI (provider-fake; real-harness nightly pending
Kabeer's secret — logged deviation), v0.1.0 tagged.
