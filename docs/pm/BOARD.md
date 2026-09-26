# Board — AEOS

> **Generated view** — as of 2026-09-26, **P1 complete (`v0.1.0` tagged);
> P2 complete (#120 merged to `main`; `v0.2.0` tag pending); P3 and P4
> complete on code and on `main` via #126 (`v0.3.0` tag pending; v0.4.0
> follows the Version PR); the repo is public
> (P5.M4.T1 verified); P5 code-complete up to the human-only steps (rc/v1.0
> tags, launch).**
> Facts are owned by [ROADMAP](../ROADMAP.md) (build tasks) and
> [sprint files](sprints/) (PM tasks). Regenerate on every status-changing
> commit per [README R3](README.md#sync-protocol-self-healing-rules); never
> hand-edit a status here without changing it at the source first.

## Now / Next / Later

| | |
|---|---|
| **Now** | Kabeer: push tags `v0.2.0` (on `2f3ac73`, the #120 merge) and `v0.3.0` (on `f5c3820`, `main` today; this triggers `release.yml`), since the agent session's git proxy refuses tag pushes; enable GitHub Pages (Source: GitHub Actions) so the docs deploy on `main` works. Manual sign-offs: P1.M4/M10 live smokes, P4.M3.T1 reboot, P5.M2.T2 blind test. |
| **Next** | P5.M6 public site/docs/install (#150–#154); v0.4.0 via the `changeset-release/develop` Version PR → `staging` → `main`; then tag `v1.0.0-rc.1` (release pipeline builds, signs and upgrade-tests it). |
| **Later** | P5.M6 public site: React landing page, Starlight docs (with React islands) over `docs/` Markdown, one-line CLI install, desktop downloads, docs sweep → P5.M4 public beta (T3 weekly grooming) → P5.M5 GA (T1 blocker burn-down, T4 post-launch week). |

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

### P2 — Safety + polish (v0.2) `[x]` — 31/31 tasks — **exit gate green 2026-09-26; v0.2.0 awaits Gate 3**

| Milestone | Tasks | Focus |
|---|---|---|
| M1 policy + approvals `[x]` | 5/5 | tiers, layered YAML, daemon-side enforcement, inbox — done 2026-08-25 (overnight session) |
| M2 budgets + audit `[x]` | 3/3 | daemon-enforced caps w/ resume-with-increase; append-only audit — done 2026-08-25 (overnight session) |
| M3 secrets store `[x]` | 3/3 | age-encrypted store (keychain-ready interface), policy-gated injection, pipeline-wide redaction; canary exit gate green — done 2026-08-25 (evening continuation) |
| M4 memory curator `[x]` | 3/3 | idle-triggered dry-run scaffold, propose-pipeline ops (deterministic v0), own trail + never-delete proof; daemon stays dry-run-only for now — done 2026-08-25 (second overnight continuation) |
| M5 PTY attach + co-edit guard `[x]` | 3/3 | runner PTY (minimal-env shell), WS attach gated to allow-tier + xterm Takeover tab, ADR-009 detect-and-pause guard (unwired by design until worktrees) — done 2026-08-25 (deps approved mid-session; third overnight continuation) |
| M6 Codex adapter `[x]` | 2/2 | recorded-fixture translation (codex-cli 0.149.1), resume, conformance parity; capability matrix test-enforced incl. README — done 2026-08-26 |
| M7 managed binaries `[x]` | 2/2 | pinned npm-integrity installs sealed by tree hash, PATH never overrides a pin, typed version gates; exit gate green: `pinned-harnesses` CI job (PR #114) — 2026-09-26 |
| M8 Tauri wrapper `[x]` | 3/3 | Tauri 2 shell: cold-starts/reuses `aeosd` and stops only an owned daemon (window close or SIGTERM); SSE → native notifications opening the agent's approvals view; `aeos://agent/<ws>/<id>/<tab>` deep links; `desktop` CI builds deb/AppImage + dmg (unsigned until P5.M3) — 2026-09-26 |
| M10 agent runtime `[x]` | 4/4 | status (events + herdr screen manifests), race-free wait, attention inbox, webhook/ntfy/slack push; fixed resume tokens being dropped under policy — added and done 2026-09-26 |
| M9 repos + worktrees + brief `[x]` | 3/3 | repo bindings, worktree per objective with agent-authored task commits, session brief with memory snapshot, review pane (herdr-reviewr idea) — added and done 2026-09-26 |

### P3 — Autonomy (v0.3) `[x]` — 11/11 tasks — **exit gate green 2026-09-26; v0.3.0 awaits Gate 3**

| Milestone | Tasks | Focus |
|---|---|---|
| M1 planner task classes `[x]` | 2/2 | `[class]`/`@agent` plan grammar (old plans default `implement`); read-only planner session → `plan.proposed.md` gated by the new `run_plan` tier (confirm by default via the approvals inbox, allow auto-runs, deny keeps it proposal-only); ADE/CLI auto-plan — 2026-09-26 |
| M2 model router `[x]` | 3/3 | new `@aeos/router`: OpenRouter-backed pricing index (daily refresh, stale-but-served offline, static first-party table); layered `routing.yaml` class → provider/model/thinking (agent prefs > workspace > home > built-in Opus/Sonnet/Haiku split); `route.decided` audited + `routes.ndjson` realized cost incl. token-priced USD for Codex — 2026-09-26 |
| M3 verification task type `[x]` | 2/2 | `verify` tasks run repo-binding/objective commands in the worktree (pass/fail/flaky, timeout kills the process group); a failure re-opens the verified code task with the output as notes and strikes the verify task (3 → blocked); planner interleaves verify tasks — 2026-09-26 |
| M4 retrospective loop `[x]` | 2/2 | deterministic post-objective retrospective: verification failures/flakes → `lessons/`, re-dos → `mistakes/`, human review comments → `preferences/`, via `memory.propose` (accept/reject in ADE/CLI/API, or `retrospective: apply` unattended); next brief carries them byte-for-byte — 2026-09-26 |
| M5 wakeups + delegation `[x]` | 2/2 | durable `<home>/jobs/*.yaml` cron (UTC, `cron-parser`) + idle jobs, `lastRunAt` written before the action, a slot missed while down fires once on boot; `/v1/jobs`, `aeos job add|list|rm`; `@agent` tasks run as that agent (own policy/routing/profile) in the owner's worktree, committed under the delegate's name — 2026-09-26 |

### P4 — Scale + community (v0.4) `[~]` — 9/10 tasks (+1 awaiting manual sign-off) — exit gate code-complete

| Milestone | Tasks | Focus |
|---|---|---|
| M1 Docker sandbox tier `[x]` | 2/2 | policy `sandbox` tier per task class; `docker run` wrapper mounting only worktree + git dir + profile + read-only binary, env by name, host uid, cap-drop; orphan reaping; `aeos sandbox build`; container golden path + escape canary e2e in CI — 2026-09-26 |
| M2 public plugin API `[x]` | 3/3 | `aeos` manifest + `PLUGIN_ABI_VERSION` contract gate (typed `contract_mismatch`); core harnesses registered through the same registry; `aeos plugin install` (npm/tarball, `--ignore-scripts`); each plugin in its own process (host-stamped, validated events; crash fails only its session, restart on demand, disable after 3); `create-aeos-plugin` + `docs/plugins.md`; tarball-installed template passes adapter conformance — 2026-09-26 |
| M3 deploy targets `[~]` | 2/3 (+1 `[~]`) | `aeos service install` (systemd user unit / LaunchAgent, `KillMode=process` so runners survive restarts); `docker compose` image + quickstart CI job; token gate scoped to `/v1` (constant-time, `/healthz`, token file) + ADE sign-in; `docs/deploy.md` TLS recipes. TLS recipes verified for Caddy + nginx by `scripts/release/verify-remote-tls.sh` (19/19); reboot sign-off manual (guide) — 2026-09-26 |
| M4 TCP + Kubernetes `[x]` | 2/2 | TLS-PSK runner transport (mutual auth, per-session 0600 key, endpoint in `runnerSocket` — contracts unchanged); re-adoption suite over unix + TCP, TLS wire fuzz; Helm chart (single-writer Deployment, PVC, kept token, hardened pod) + `helm-lint` on PRs + `nightly-k8s` kind golden path — 2026-09-26 |

### P5 — v1.0 public release `[~]` — 11/23 tasks (+4 awaiting a human)

| Milestone | Tasks | Focus | Gate |
|---|---|---|---|
| M1 OSS readiness `[x]` | 4/4 | LICENSE ADR ✓, health files ✓, license audit ✓, history hygiene ✓ | done 2026-07-18 (early, per spine exception) |
| M2 docs site + onboarding `[~]` | 3/4 (+1 `[~]`) | Starlight site generated from `docs/` (links rewritten, ADR index generated, built-site link+anchor check, Pages deploy on main); quickstart + first-agent tutorial executed by CI; reproducible screenshots + asciicast (`demo:assets`) | blind newcomer test manual |
| M3 release engineering `[~]` | 2/3 (+1 `[~]`) | changesets fixed group + Version-PR workflow; `release.yml` (verify → self-contained bundles w/ smoke → npm packs → Tauri → SBOM + cosign keyless → GHCR + GitHub Release + npm provenance); `docs/compatibility.md` | rc tag = Gate 3 (Kabeer) |
| M4 public beta `[~]` | 2/3 | repo public, Issues + Discussions on, `main` protected (required `ci`), gitleaks clean over full history; triage live: `.github/labels.yml` + label-sync, SLA table in CONTRIBUTING, 11 seeded good-first issues (#134–#144); beta announcement + grooming are Kabeer's | requires P4 exit |
| M5 GA launch `[~]` | 0/4 (+2 `[~]`) | upgrade test (older release → this build on the same `AEOS_HOME`) wired into `release.yml`, green from v0.1.0 and staging; v1.0.0 notes + launch-kit drafts in `notes/launch/`; tag, publishing and posting are Kabeer's | = v1 |
| M6 public site + install `[ ]` | 0/5 | added 2026-09-26 at Kabeer's request: React landing page (T1); proper docs on Starlight (kept) over `docs/` Markdown, React for interactive pieces (T2); Claude-Code-style one-line CLI install with verified bundles + `aeos update` (T3); Claude-Cowork-style signed desktop downloads per OS with auto-update (T4); Markdown docs sweep + generated CLI/API reference with drift tests (T5) | newcomer: landing page → running agent |

**Total defined work: 119 tasks** (44 P1 + 31 P2 + 11 P3 + 10 P4 + 23 P5)
across 35 milestones, plus 4 tracked post-v1 backlog items (scope changes:
2026-07-19 +M4.T6 multi-account subscriptions, +P1.M10 OpenCode, P2.M6.T2
retired; 2026-09-26 +P2.M9 repo bindings/worktrees/review, +P2.M10 herdr-derived
agent runtime, +P5.M6 public site / docs / one-line install). Every task has an accept criterion in the ROADMAP; **106 are
done, 5 are `[~]` awaiting a human step** (P4.M3.T1, P5.M2.T2, P5.M3.T2,
P5.M5.T2/T3) and **8 are open** — the five P5.M6 public-site/install tasks, beta grooming, the blocker burn-down at cut time and the post-launch week (P5.M6.T1–T5, P5.M4.T3, P5.M5.T1/T4).
Open tasks keep a matching GitHub issue
(`[AEOS-P<p>.M<m>.T<t>]` titles, phase milestones, `task` + `phase:*` + `area:*` labels).

## Active sprint

[S16](sprints/S16.md) — P4 scale + community and P5 v1.0 readiness (2026-09-26); every agent-doable task done, remaining work is Kabeer's. Previous: [S15](sprints/S15.md) — P3 autonomy, closed at the exit gate.
P2 is closed: S14 plus the Gate 2 promotion PR #119, with v0.2.0 awaiting Gate 3.

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
| D15 | 2026-09-26 | BOARD P2 table carried stale duplicate rows (M6 `0/2`, M7 twice) and a `19/25` count; ROADMAP owns 24 P2 tasks (T2 of M6 retired) | **Fixed same day**: duplicates dropped, count → 19/24 |
| D16 | 2026-09-26 | Stray-branch sweep: `chore/aeos-m4-smoke-harness`, `feat/aeos-p1-m1-contracts`, `feat/aeos-p1-m3-runner`, `feat/p2-m6-codex` carry zero commits beyond `develop` (all merged via PRs) | **Logged**: no feature to rescue; remote deletion left to Kabeer (agent delete blocked by permission policy) |
| D17 | 2026-09-26 | BOARD header + Now/Next rows still read "as of 2026-08-26 … P2 underway, M7 next" through P2 exit and P3.M1–M4 (R3 miss, same class as D13) | **Fixed same day** at the P3 exit commit: header and Now/Next regenerated |
| D18 | 2026-09-26 | Spec §7 requires a transcript per session, but objective-run task sessions had no session record, so every event logged `TranscriptRoutingError` and no transcript was written (the canary e2e called it a "documented v0 deferral"); an errored objective run was also silent in the daemon log | **Fixed same day** (`fix/objective-transcripts`): scheduler `onSessionStarted/onSessionEnded` hooks register each task session (session.yaml + index, under the executing agent); canary e2e now asserts transcripts exist and never contain the canary; errored runs log to stderr |
| D19 | 2026-09-26 | GitHub task issues (one per ROADMAP task) were never closed as tasks completed: 30 issues for `[x]` tasks (P2.M1/M6/M7/M8, all of P3, P4 except M3.T1/T3, P5.M2.T1/T3/T4) were still open; three done tasks also carried `good first issue` | **Fixed same day**: closed as completed — P2.M7→#114, P2.M8→#117, P3.M1→#118, M2→#121, M3→#122, M4→#123, M5→#124, P4.M1→#127, M2→#128, M3.T2→#129, M4→#131, P5.M2→#132 (P2.M1/M6 predate this log). Tasks at `[~]` (manual sign-off) stay open. Rule going forward: the PR completing a task closes its issue (`Closes #n`) |
| D20 | 2026-09-26 | The BOARD totals paragraph still said 107 tasks / 67 done / 40 remaining after P2.M9 and P2.M10 were added and P2–P5 were worked through; the Now/Next rows still described P4 as underway | **Fixed same day**: recounted from ROADMAP checkboxes (114 tasks: 104 `[x]`, 6 `[~]`, 4 `[ ]`), rewrote the header and Now/Next/Later |
| D21 | 2026-09-26 | The repo was already public, with Issues and Discussions on, while ROADMAP/BOARD still listed "repo flip" (P5.M4.T1) as Kabeer's open step; S16 also justified leaving out arm runners because the repo was private | **Fixed same day**: T1 verified post-flip (`main` protection with required `ci`, community profile 100%, gitleaks clean over full history) and flipped `[x]`, issue #85 closed. The arm-runner note stays accurate as history; re-check arm availability now that the repo is public |
| D22 | 2026-09-26 | GitHub treats #120 (`staging`→`main`) and #126 (`develop`→`staging`) as a stack. When #120 merged, #126 was retargeted onto `main` and merged there, so `main` jumped straight to `develop`@`b4f1f47` (0.3.0, P3–P5) and skipped the Gate 2 hop; `staging` was left behind | **Fixed same day**: `staging` synced to `main` (#155). Rule going forward: don't open a Gate 2 PR while its `staging` is the head of an open Gate 3 PR; open it after the release merges. The v0.3.0 artifacts carry P4/P5 code the v0.3.0 notes don't describe; v0.4.0's notes cover it |
