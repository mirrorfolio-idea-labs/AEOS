# Board — AEOS

> **Generated view** — as of 2026-08-25 (`c6b2600`), **P1 complete (`v0.1.0`
> tagged); P2 underway — M1–M3 done, M4 next.**
> Facts are owned by [ROADMAP](../ROADMAP.md) (build tasks) and
> [sprint files](sprints/) (PM tasks). Regenerate on every status-changing
> commit per [README R3](README.md#sync-protocol-self-healing-rules); never
> hand-edit a status here without changing it at the source first.

## Now / Next / Later

| | |
|---|---|
| **Now** | P2 underway: **M1+M2+M3 complete** (policy/approvals, budgets/audit, secrets) (2026-08-25; overnight session + evening continuation — dockerized live-smoke evidence in `notes/`). S07 closed at the canary
gate; S08 opens on P2.M4. |
| **Next** | P2.M4 memory curator (plan just-in-time). Kabeer's M4/M10 native-host live smokes remain open, non-blocking (dockerized evidence run green via OpenRouter gateway). |
| **Later** | P2 (v0.2 safety) → P3 (v0.3 autonomy) → P4 (v0.4 scale) → P5 (v1.0 launch). P5.M2 (docs site) may run in parallel from P2 onward. |

## Milestones

Task counts and statuses are derived from [ROADMAP](../ROADMAP.md).

### P1 — Spine (v0.1) `[x]` — **v0.1.0 tagged 2026-07-20**

| Milestone | Status | Tasks | Plan | Notes |
|---|---|---|---|---|
| M1 contracts | `[x]` | 6/6 | [plan](../superpowers/plans/2026-07-13-aeos-p1-m1-contracts.md) | merged to `main` (`8506974`); CI-identical chain verified green on `main` (19/19 tests) — remote CI run pending first push |
| M2 kernel | `[x]` | 5/5 | [plan](../superpowers/plans/2026-07-13-aeos-p1-m2-kernel.md) | merged to `main`; exit-gate tests (crash-sim ×100, reindex equivalence) green; 69/69 tests |
| M3 session runner | `[x]` | 4/4 | [plan](../superpowers/plans/2026-07-14-aeos-p1-m3-runner.md) | complete on `feat/aeos-p1-m3-runner`; flagship re-adoption test green; 100/100 workspace tests; remote CI run pending first push |
| M4 Claude provider | `[~]` | 6/6 | [plan](../superpowers/plans/2026-07-18-aeos-p1-m4-claude-provider.md) | T1–T5 (PR #98) + T6 multi-account slots (PR #104); exit gate = manual live smoke (guide in `guides/`) |
| M5 memory v0 | `[x]` | 4/4 | [plan](../superpowers/plans/2026-07-19-aeos-p1-m5-memory.md) | merged PR #106; exit gate CI-verified |
| M6 scheduler v0 | `[x]` | 4/4 | [plan](../superpowers/plans/2026-07-19-aeos-p1-m6-scheduler.md) | merged PR #107; crash-resume proven (daemon-level kill lands in M9) |
| M7 API+SSE+SDK | `[x]` | 4/4 | [plan](../superpowers/plans/2026-07-19-aeos-p1-m7-api.md) | merged PR #108; CLI golden path green |
| M8 ADE web UI | `[x]` | 4/4 | [plan](../superpowers/plans/2026-07-19-aeos-p1-m8-ade-ui.md) | merged PR #109; shadcn UI, Playwright suite in CI |
| M9 E2E + hardening | `[x]` | 4/4 | [plan](../superpowers/plans/2026-07-20-aeos-p1-m9-hardening.md) | merged PR #110; 10x-green golden-path E2E; **v0.1.0 tagged** |
| M10 OpenCode adapter | `[~]` | 3/3 | [plan](../superpowers/plans/2026-07-19-aeos-p1-m10-opencode.md) | T1–T3 merged (PR #105); exit gate = manual live smoke (guide in `guides/`) |

### P2 — Safety + polish (v0.2) `[~]` — 11/25 tasks

| Milestone | Tasks | Focus |
|---|---|---|
| M1 policy + approvals `[x]` | 5/5 | tiers, layered YAML, daemon-side enforcement, inbox — done 2026-08-25 (overnight session) |
| M2 budgets + audit `[x]` | 3/3 | daemon-enforced caps w/ resume-with-increase; append-only audit — done 2026-08-25 (overnight session) |
| M3 secrets store `[x]` | 3/3 | age-encrypted store (keychain-ready interface), policy-gated injection, pipeline-wide redaction; canary exit gate green — done 2026-08-25 (evening continuation) |
| M4 memory curator | 0/3 | idle-triggered, dry-run, never-delete |
| M5 PTY attach + co-edit guard | 0/3 | human takeover, OQ1 ADR |
| M6 Codex adapter | 0/2 | conformance parity (OpenCode moved to P1.M10) |
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

### P5 — v1.0 public release `[~]` — 4/18 tasks

| Milestone | Tasks | Focus | Gate |
|---|---|---|---|
| M1 OSS readiness `[x]` | 4/4 | LICENSE ADR ✓, health files ✓, license audit ✓, history hygiene ✓ | done 2026-07-18 (early, per spine exception) |
| M2 docs site + onboarding | 0/4 | site from `docs/`, quickstarts, demo assets | parallel from P2 |
| M3 release engineering | 0/3 | changesets, signed CI-only artifacts + SBOM, compat policy | after M1–M2 |
| M4 public beta | 0/3 | repo flip, triage workflow, feedback grooming | requires P4 exit |
| M5 GA launch | 0/4 | blocker burn-down, v1.0.0, comms, post-launch week | = v1 |

**Total defined work: 107 tasks** (44 P1 + 24 P2 + 11 P3 + 10 P4 + 18 P5)
across 32 milestones, plus 4 tracked post-v1 backlog items (scope change
2026-07-19: +M4.T6 multi-account subscriptions, +P1.M10 OpenCode, P2.M6.T2
retired). Every task has an accept criterion in the ROADMAP; 59 are done
(P1 M1–M8 + M10 code-complete — M4/M10 gated only on Kabeer's manual
smokes — plus P5.M1 and P2.M1–M3), 48 remain to v1 — each open task has a matching
GitHub issue
(`[AEOS-P<p>.M<m>.T<t>]` titles, phase milestones, `task` + `phase:*` + `area:*` labels).

## Active sprint

[S07](sprints/S07.md) — P2.M3 secrets store, closed 2026-08-25 at the
canary exit gate. Next sprint opens on P2.M4 (memory curator).

## Blockers

None.

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
| D9 | 2026-08-25 | Spec §7 layout names audit files `audit-YYYY-MM-DD.ndjson` while §11 says `audit/*.ndjsonl` | **Resolved** same day (P2.M2.T3): §7 owns paths — `.ndjson` shipped; §11 wording treated as prose about format, not extension |
| D8 | 2026-08-25 | Cold-pickup R5 scan (overnight gauntlet): P5.M1 is `[x]` but has no milestone plan file under `docs/superpowers/plans/` (R5 rule 3) | **Waived same day**: executed early under the documented spine exception via PRs #96/#97 inside S03/S04; ADR-001 + the community health files are the durable record — a retroactive plan adds no information |
| D10 | 2026-08-25 | ROADMAP P2.M3.T1 accept says "keychain + age fallback, round-trip on both backends"; shipped store is age-only v0 (Kabeer decision: no native keychain dep in v0.2) | **Resolved same day**: T1 accept text reworded to age-only v0 with a keychain-ready interface (D2 precedent); S07 log carries the decision |
| D11 | 2026-08-25 | Dockerized live smokes surfaced harness drift: opencode ≥1.18 replaced the ≤1.17 `--format json` line shapes; the M10 translator skipped every line → zero canonical events from live sessions | **Fixed same day** (7eb1b6f): ≥1.18 step-based shapes translated additively, modern fixture recorded from opencode-ai@1.18.23; July fixtures byte-identical; CLIs pinned in the smoke runner until P2.M7 managed binaries land |
| D12 | 2026-08-25 | Cold-pickup sweep (overnight continuation): ROADMAP phase headers for P2 and P5 still `[ ]` despite completed tasks inside them (P2 11/25; P5.M1 4/4) — same class as D1 | **Fixed same day**: both phase headers → `[~]` |
| D13 | 2026-08-25 | Generated views stale after the three P2 exits (R3): BOARD header still read "as of 2026-07-20 … Session parked" while its body was current, and TRACEABILITY was untouched since `v0.1.0` (no P2.M1–M3 rows) | **Fixed same day**: BOARD header corrected to `c6b2600`; TRACEABILITY regenerated through P2.M3 with a fresh verification record |
| D14 | 2026-08-25 | R5 scan: T2's checkbox flip missed its own commit (2a018fe) and landed retroactively in b00fb2d (self-documented there) — one-time violation of the same-commit rule | **Logged, no action**: ID↔checkbox invariant verified clean across all 107 tasks |
