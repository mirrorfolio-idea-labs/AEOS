# Board — AEOS

> **Generated view** — as of 2026-07-20, **Phase P1 complete, v0.1.0 tagged.** Session parked.
> Facts are owned by [ROADMAP](../ROADMAP.md) (build tasks) and
> [sprint files](sprints/) (PM tasks). Regenerate on every status-changing
> commit per [README R3](README.md#sync-protocol-self-healing-rules); never
> hand-edit a status here without changing it at the source first.

## Now / Next / Later

| | |
|---|---|
| **Now** | **v0.1.0 tagged and released** (PR #110 merged M9; all P1 issues #24–#27 closed). Session parked — resume guide: `guides/2026-07-20-session-parking-resume.md`. Community profile 100%. |
| **Next** | Kabeer's M4/M10 live-harness smokes (guides in `guides/`) whenever convenient — not blocking. Then: pick a P2 milestone to open S05, or continue toward v0.2. |
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

### P2 — Safety + polish (v0.2) `[ ]` — 0/25 tasks

| Milestone | Tasks | Focus |
|---|---|---|
| M1 policy + approvals | 0/5 | tiers, layered YAML, daemon-side enforcement, inbox |
| M2 budgets + audit | 0/3 | daemon-enforced caps, append-only audit |
| M3 secrets store | 0/3 | keychain/age, injection, redaction canary |
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
retired). Every task has an accept criterion in the ROADMAP; 44 are done
(P1 M1–M8 + M10 code-complete — M4/M10 gated only on Kabeer's manual
smokes — plus P5.M1), 63 remain to v1 — each open task has a matching
GitHub issue
(`[AEOS-P<p>.M<m>.T<t>]` titles, phase milestones, `task` + `phase:*` + `area:*` labels).

## Active sprint

None. [S04](sprints/S04.md) closed 2026-07-20 at the v0.1.0 tag (retro in
the sprint file). Next sprint opens when work resumes on P2 or the
manual smokes land.

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
| D8 | 2026-08-25 | Cold-pickup R5 scan (overnight gauntlet): P5.M1 is `[x]` but has no milestone plan file under `docs/superpowers/plans/` (R5 rule 3) | **Waived same day**: executed early under the documented spine exception via PRs #96/#97 inside S03/S04; ADR-001 + the community health files are the durable record — a retroactive plan adds no information |
