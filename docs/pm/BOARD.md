# Board — AEOS

> **Generated view** — as of merge `8506974`, 2026-07-13, branch `main` (M1 exit).
> Facts are owned by [ROADMAP](../ROADMAP.md) (build tasks) and
> [sprint files](sprints/) (PM tasks). Regenerate on every status-changing
> commit per [README R3](README.md#sync-protocol-self-healing-rules); never
> hand-edit a status here without changing it at the source first.

## Now / Next / Later

| | |
|---|---|
| **Now** | [PM-S01-4](sprints/S01.md#pm-s01-4--author-m2-plan) — author M2 kernel plan (M1 exit gate passed) |
| **Next** | Sprint 02: execute P1.M2 (kernel: state store, registry, event bus) |
| **Later** | P1.M3–M9 → P2 (v0.2) → P3 (v0.3) → P4 (v0.4) → P5 (v1.0 launch). P5.M1–M2 (OSS readiness, docs site) may run in parallel from P2 onward. |

## Milestones

Task counts and statuses are derived from [ROADMAP](../ROADMAP.md).

### P1 — Spine (v0.1) `[~]`

| Milestone | Status | Tasks | Plan | Notes |
|---|---|---|---|---|
| M1 contracts | `[x]` | 6/6 | [plan](../superpowers/plans/2026-07-13-aeos-p1-m1-contracts.md) | merged to `main` (`8506974`); CI-identical chain verified green on `main` (19/19 tests) — remote CI run pending first push |
| M2 kernel | `[ ]` | 0/5 | to write (PM-S01-4) | gated on M1 exit |
| M3 session runner | `[ ]` | 0/4 | — | |
| M4 Claude provider | `[ ]` | 0/5 | — | |
| M5 memory v0 | `[ ]` | 0/4 | — | |
| M6 scheduler v0 | `[ ]` | 0/4 | — | heart of the phase (M6.T4) |
| M7 API+SSE+SDK | `[ ]` | 0/4 | — | |
| M8 ADE web UI | `[ ]` | 0/4 | — | `mockup.png` is the design ref |
| M9 E2E + hardening | `[ ]` | 0/4 | — | exit = P1 exit gate, tags v0.1 |

### P2 — Safety + polish (v0.2) `[ ]` — 0/25 tasks

| Milestone | Tasks | Focus |
|---|---|---|
| M1 policy + approvals | 0/5 | tiers, layered YAML, daemon-side enforcement, inbox |
| M2 budgets + audit | 0/3 | daemon-enforced caps, append-only audit |
| M3 secrets store | 0/3 | keychain/age, injection, redaction canary |
| M4 memory curator | 0/3 | idle-triggered, dry-run, never-delete |
| M5 PTY attach + co-edit guard | 0/3 | human takeover, OQ1 ADR |
| M6 Codex + OpenCode adapters | 0/3 | conformance across 3 harnesses |
| M7 managed binaries | 0/2 | pin/verify, version-gated capabilities |
| M8 Tauri wrapper | 0/3 | desktop shell, notifications, CI artifacts |

### P3 — Autonomy (v0.3) `[ ]` — 0/11 tasks

| Milestone | Tasks | Focus |
|---|---|---|
| M1 planner task classes | 0/2 | classed plan generation, approval gate |
| M2 model router | 0/3 | pricing index, class routing, cost logging |
| M3 verification task type | 0/2 | verify gates progression, 3-strike |
| M4 retrospective loop | 0/2 | lessons/preferences feed next snapshot |
| M5 wakeups + delegation | 0/2 | durable cron/idle jobs, multi-agent |

### P4 — Scale + community (v0.4) `[ ]` — 0/10 tasks

| Milestone | Tasks | Focus |
|---|---|---|
| M1 Docker sandbox tier | 0/2 | container runner, escape canary |
| M2 public plugin API | 0/3 | manifest/loader, install flow, template |
| M3 deploy targets | 0/3 | service install, compose, remote posture |
| M4 TCP + Kubernetes | 0/2 | authed TCP transport, Helm/kind CI |

### P5 — v1.0 public release `[ ]` — 0/18 tasks

| Milestone | Tasks | Focus | Gate |
|---|---|---|---|
| M1 OSS readiness | 0/4 | LICENSE ADR, health files, license audit, history hygiene | parallel from P2 |
| M2 docs site + onboarding | 0/4 | site from `docs/`, quickstarts, demo assets | parallel from P2 |
| M3 release engineering | 0/3 | changesets, signed CI-only artifacts + SBOM, compat policy | after M1–M2 |
| M4 public beta | 0/3 | repo flip, triage workflow, feedback grooming | requires P4 exit |
| M5 GA launch | 0/4 | blocker burn-down, v1.0.0, comms, post-launch week | = v1 |

**Total defined work: 104 tasks** (40 P1 + 25 P2 + 11 P3 + 10 P4 + 18 P5)
across 31 milestones, plus 4 tracked post-v1 backlog items. Every task has an
accept criterion in the ROADMAP; 6 are done (M1 complete), 98 remain to v1.

## Active sprint

[S01 — Close M1, open M2](sprints/S01.md) · goal: M1 exit gate + M2 plan.

## Blockers

None. (T6 is unstarted, not blocked.)

## Drift register

| ID | Found | Finding | Resolution |
|---|---|---|---|
| D1 | 2026-07-13 | ROADMAP M1 marked `[ ]` while T1–T5 were `[x]` | **Fixed** same day: M1 → `[~]` |
| D2 | 2026-07-13 | ROADMAP M1.T4 accept says "compile-time exhaustiveness check"; implementation is a runtime golden-fixture test (plan-approved) | **Fixed** same day at M1 exit (PM-S01-2): accept text reworded to match the implementation |
| D3 | 2026-07-13 | No project `CLAUDE.md` (required entry point for delegated agents) | **Fixed** same day: root `CLAUDE.md` added |
| D4 | 2026-07-13 | `.superpowers/sdd/progress.md` tracks review debts outside the task system | **Fixed** same day: imported as PM-S01-2/PM-S01-3 |
| D5 | 2026-07-13 | Old ROADMAP P4 blurb listed "multi-user auth" inside v1 scope, contradicting spec §14 ("multi-user RBAC is post-v1") | **Fixed** same day: resolved in favor of the spec — moved to post-v1 backlog **B2**; P4.M3.T3 keeps the single-user token layer |
| D6 | 2026-07-13 | T6 WIP commit `13035e9` leaves `pnpm depcruise` failing: script globs `apps/`, which doesn't exist yet (verified by direct run) | **Fixed** same day in T6 completion: `apps/.gitkeep` created (dir is real — workspace already declares `apps/*`) |
| D7 | 2026-07-13 | README badge hardcodes "17/17 tests green" — a static claim that will silently go stale | **Fixed** same day in T6 completion: swapped for the live CI workflow badge |
