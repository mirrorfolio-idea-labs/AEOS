# Board — AEOS

> **Generated view** — as of `6c8858e` on `feat/aeos-p1-m1-contracts`, 2026-07-13.
> Facts are owned by [ROADMAP](../ROADMAP.md) (build tasks) and
> [sprint files](sprints/) (PM tasks). Regenerate on every status-changing
> commit per [README R3](README.md#sync-protocol-self-healing-rules); never
> hand-edit a status here without changing it at the source first.

## Now / Next / Later

| | |
|---|---|
| **Now** | [AEOS-P1.M1.T6](tasks/AEOS-P1.M1.T6.md) — depcruise + CI (last open M1 task) · [PM-S01-3](sprints/S01.md#pm-s01-3--deferred-review-minors-tests) — deferred test minors (parallelizable) |
| **Next** | PM-S01-1 merge to `main` → PM-S01-2 M1 exit doc pass → PM-S01-4 author M2 plan |
| **Later** | M2–M9 (see [EPICS](EPICS.md) / [ROADMAP](../ROADMAP.md)); P2–P4 defined at P1 exit |

## Phase P1 milestones

| Milestone | Status | Tasks done | Plan | Notes |
|---|---|---|---|---|
| M1 contracts | `[~]` | 5/6 (T6 open) | [plan](../superpowers/plans/2026-07-13-aeos-p1-m1-contracts.md) | T1–T5 on branch, 17/17 tests verified green |
| M2 kernel | `[ ]` | 0/5 | to write (PM-S01-4) | gated on M1 exit |
| M3 session runner | `[ ]` | 0/4 | — | |
| M4 Claude provider | `[ ]` | 0/5 | — | |
| M5 memory v0 | `[ ]` | 0/4 | — | |
| M6 scheduler v0 | `[ ]` | 0/4 | — | heart of the phase (M6.T4) |
| M7 API+SSE+SDK | `[ ]` | 0/4 | — | |
| M8 ADE web UI | `[ ]` | 0/4 | — | `mockup.png` is the design ref |
| M9 E2E + hardening | `[ ]` | 0/4 | — | exit = P1 exit gate |

## Active sprint

[S01 — Close M1, open M2](sprints/S01.md) · goal: M1 exit gate + M2 plan.

## Blockers

None. (T6 is unstarted, not blocked.)

## Drift register

| ID | Found | Finding | Resolution |
|---|---|---|---|
| D1 | 2026-07-13 | ROADMAP M1 marked `[ ]` while T1–T5 were `[x]` | **Fixed** same day: M1 → `[~]` |
| D2 | 2026-07-13 | ROADMAP M1.T4 accept says "compile-time exhaustiveness check"; implementation is a runtime golden-fixture test (plan-approved) | Open — owned by [PM-S01-2](sprints/S01.md), reword at M1 exit |
| D3 | 2026-07-13 | No project `CLAUDE.md` (required entry point for delegated agents) | **Fixed** same day: root `CLAUDE.md` added |
| D4 | 2026-07-13 | `.superpowers/sdd/progress.md` tracks review debts outside the task system | **Fixed** same day: imported as PM-S01-2/PM-S01-3; progress.md remains the raw review record (not duplicated) |
