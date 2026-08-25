# Traceability — requirements → design → implementation → testing → deployment

> **Generated view** — as of `fceb790`, 2026-08-25 (P1 complete, `v0.1.0`
> tagged; P2 M1–M5 done). Regenerate per [README R3](README.md). Spec =
> `docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`.

## Requirements → milestones (design coverage)

Every spec section maps to at least one milestone (source: ROADMAP context briefs).

| Spec section | Covered by |
|---|---|
| §1–§4 thesis, decisions, overview | all of P1 (golden-path exit gate) |
| §5 repo structure, §6 kernel contracts | P1.M1 (contracts, boundaries), P1.M2 (kernel) |
| §7 domain model | P1.M1.T3 (schemas), P1.M2 (store/registry), P1.M6 (objective/plan/checkpoint) |
| §8 memory system | P1.M5 (store/snapshot/propose); curator → P2.M4; self-learning loop → P3.M4 |
| §9 provider layer + BYOK credential profiles | P1.M4 (Claude); Codex/OpenCode → P2.M6; managed binaries → P2.M7; PTY attach → P2.M5; direct-API family → backlog B1 |
| §10 execution engine + sandboxing | P1.M3 (runner/supervisor); container tier → P4.M1 |
| §11 security & policy | P2.M1 (policy+approvals), P2.M2 (budgets+audit), P2.M3 (secrets); kill switch early in P1.M9.T3 |
| §12 scheduler/planner | P1.M6 (v0 loop); P3.M1 (planner), P3.M3 (verification), P3.M5 (wakeups+delegation) |
| §13 cost-aware routing | P3.M2 |
| §14 API + UI | P1.M7 (API/SDK), P1.M8 (web UI); approvals inbox → P2.M1.T5; Tauri → P2.M8; token auth → P4.M3.T3; RBAC → backlog B2 |
| §15 plugins | P4.M2 (public API; mechanism exercised in-repo from P1) |
| §16 deployment | P4.M3 (service/compose/remote), P4.M4 (TCP+K8s); CI-only in P1 via M1.T6 |
| §17 pre-mortem | 17.1→P1.M6, 17.2→P2.M7, 17.3→P1.M3.T1, 17.4→P2.M4, 17.5→P2.M2+P1.M9.T3, 17.6→backlog B3, 17.7→backlog B4, 17.8→the ROADMAP itself |
| §18 testing strategy | every task's accept; e2e in P1.M9; conformance in P2.M6; release smoke in P5.M3 |
| §19 build decomposition | ROADMAP itself |
| §20 open questions | OQ1→P2.M5.T3 (ADR), OQ2→B1, OQ3→B2, OQ4→B3 |

**v1 release path (requirements with no spec section):** open-source and
launch requirements are defined directly in ROADMAP Phase P5 (license,
community health, docs site, CI-only release engineering, beta, GA). P5 is
their source of truth; the spec deliberately doesn't cover them.

## Implemented work (task → code → tests → commit)

| Task | Code (packages/contracts) | Tests | Commit |
|---|---|---|---|
| AEOS-P1.M1.T1 scaffold | root workspace files, `package.json`, `tsconfig.json` | `test/smoke.test.ts` | `a76db81` |
| AEOS-P1.M1.T2 envelope + ULID ids | `src/envelope.ts`, `src/ids.ts`, `src/version.ts` | `test/envelope.test.ts` | `b4bcfcf` |
| AEOS-P1.M1.T3 domain schemas | `src/domain/{workspace,agent,credential,session,objective}.ts` | `test/domain.test.ts` | `82157f3` |
| AEOS-P1.M1.T4 event taxonomy | `src/events/taxonomy.ts` | `test/events.test.ts` + `test/fixtures/events.golden.ndjson` | `09e506e` |
| AEOS-P1.M1.T5 JSON Schema export | `scripts/gen-schemas.ts`, `schemas/*.json` | `test/schema-drift.test.ts` | `6c8858e` |
| AEOS-P1.M1.T6 boundaries + CI | `.dependency-cruiser.cjs`, `.github/workflows/ci.yml`, `apps/.gitkeep` | depcruise RED/GREEN proof (scratch violation) + CI chain | `84b6e74` |
| PM-S01-3 test hardening | `packages/contracts/tsconfig.test.json` | min(1) rejections, `.strict()` isolation | `e3ffde9` |
| AEOS-P1.M2.T1 layout/atomic/codecs | `packages/kernel/src/home/{paths,atomic,codecs}.ts` | `test/{paths,atomic,codecs}.test.ts` (crash-sim ×100) | `7119e90` |
| AEOS-P1.M2.T2 derived index | `packages/kernel/src/index-db/{db,schema,reindex}.ts` | `test/reindex.test.ts` (rebuild equivalence) | `1479c71` |
| AEOS-P1.M2.T3 registry | `packages/kernel/src/registry/{registry,git}.ts` | `test/registry.test.ts` (git history per mutation) | `725c5d9` |
| AEOS-P1.M2.T4 event bus + transcripts | `packages/kernel/src/bus/{bus,transcript}.ts` | `test/bus.test.ts` (order + isolation) | `128a4e7` |
| AEOS-P1.M2.T5 lifecycle + aeosd | `packages/kernel/src/lifecycle.ts`, `apps/aeosd/src/*` | `test/lifecycle.test.ts`, `apps/aeosd/test/daemon.test.ts` | `cae14b6` |
| AEOS-P1.M3.T1 framed protocol + handshake | `packages/runner/src/protocol/{frames,messages}.ts` | `test/{frames,handshake}.test.ts` (1000-iter seeded fuzz) | `29c7711` |
| AEOS-P1.M3.T2 runner process | `packages/runner/src/runner/{ring-buffer,runner,main}.ts`, `src/protocol/client.ts` | `test/{ring-buffer,runner}.test.ts` (disconnect survival) | `ab43e2b` |
| AEOS-P1.M3.T3 supervisor + re-adoption | `packages/runner/src/supervisor/supervisor.ts`, kernel `skipSession`, aeosd `supervisor` module | `test/supervisor.test.ts` (flagship re-adoption), kernel `bus.test.ts` | `d2d6368` |
| AEOS-P1.M3.T4 session state machine | `packages/runner/src/supervisor/session-state.ts` | `test/session-state.test.ts` | `e09337d` |
| AEOS-P1.M4.T1 HarnessAdapter + conformance + fake | `packages/provider-core/src/{adapter,conformance,provider-fake}.ts` | `test/provider-fake.test.ts` | PR #98 |
| AEOS-P1.M4.T2 hermetic profile builder | `packages/provider-claude/src/profile.ts` | `test/profile.test.ts` | PR #98 |
| AEOS-P1.M4.T3 translate + golden fixtures | `packages/provider-claude/src/translate.ts` | `test/translate.test.ts`, `test/fixtures/*` | PR #98 |
| AEOS-P1.M4.T4 resume + credential switch | `packages/provider-claude/src/resume.ts` | `test/resume.test.ts` | PR #98 |
| AEOS-P1.M4.T5 usage-limit failover | `packages/provider-claude/src/failover.ts` | `test/failover.test.ts` | PR #98 |
| AEOS-P1.M4.T6 multi-account subscription slots | `packages/contracts` credential schema, `packages/provider-claude/src/profile.ts` `subscriptionHomeFor` | `test/profile.test.ts` (slot isolation) | PR #104 |
| AEOS-P1.M5.T1 memory store | `packages/memory/src/{layout,store}.ts` | `test/store.test.ts` (over-budget error, archive) | PR #106 |
| AEOS-P1.M5.T2 snapshot composer | `packages/memory/src/snapshot.ts` | `test/snapshot.test.ts` (determinism) | PR #106 |
| AEOS-P1.M5.T3 memory.propose queue | `packages/memory/src/propose.ts` | `test/propose.test.ts` | PR #106 |
| AEOS-P1.M5.T4 FTS + search | `packages/memory/src/fts.ts` | `test/fts.test.ts` (rebuild ≡ incremental) | PR #106 |
| AEOS-P1.M6.T1 plan.md parser/writer | `packages/scheduler/src/plan.ts` | `test/plan.test.ts` (property round-trip) | PR #107 |
| AEOS-P1.M6.T2 checkpoint store + resolver | `packages/scheduler/src/checkpoint.ts` | `test/checkpoint.test.ts` (crash-point matrix) | PR #107 |
| AEOS-P1.M6.T3+T4 scheduler loop + resume | `packages/scheduler/src/scheduler.ts` | `test/scheduler.test.ts` (3-strike, resume-on-boot) | PR #107 |
| AEOS-P1.M7.T1 API skeleton | `packages/api/src/{server,envelope}.ts`, `openapi.json` | `test/api.test.ts`, `test/openapi-drift.test.ts` | PR #108 |
| AEOS-P1.M7.T2 resource routes | `packages/api/src/routes/{workspaces,agents,objectives,memory}.ts` | `test/api.test.ts` | PR #108 |
| AEOS-P1.M7.T3 SSE + backfill | `packages/api/src/routes/events.ts` | `test/api.test.ts` (exactly-once reconnect) | PR #108 |
| AEOS-P1.M7.T4 SDK + CLI | `packages/sdk/src/client.ts`, `apps/cli/src/cli.ts` | `test/client.test.ts`, `apps/cli/test/golden-path.test.ts` | PR #108 |
| AEOS-P1.M8.T1–T4 ADE web UI | `apps/ade/src/*` | `apps/ade/test/ade.spec.ts` (Playwright, 4 specs) | PR #109 |
| AEOS-P1.M9.T1 daemon wiring + E2E | `apps/aeosd/src/api-module.ts`, daemon.ts `api` module | `apps/aeosd/test/golden-path.e2e.test.ts` (10× SIGKILL+resume) | PR #110 |
| AEOS-P1.M9.T2 nightly live E2E | `.github/workflows/nightly-live-e2e.yml` | secret-gated; manual trigger verifies | PR #110 |
| AEOS-P1.M9.T3 STOP kill switch | `packages/scheduler/src/scheduler.ts`, `packages/api/src/routes/objectives.ts`, `apps/cli/src/cli.ts` | `apps/aeosd/test/golden-path.e2e.test.ts` (kill-switch spec) | PR #110 |
| AEOS-P1.M9.T4 docs + ADRs + tag | `README.md`, `docs/adr/ADR-002..008.md` | clean-clone quickstart verified manually | PR #110, tag `v0.1.0` |
| AEOS-P1.M10.T1–T3 OpenCode adapter | `packages/provider-opencode/src/*` | `test/{profile,translate,adapter}.test.ts` | PR #105 |
| AEOS-P2.M1.T1 tier schemas + layered loader | `packages/contracts/src/domain/policy.ts`, `packages/policy/src/{load,merge}.ts` | `contracts/test/policy.test.ts`, `policy/test/{load,merge}.test.ts` | `76d776d` |
| AEOS-P2.M1.T2 classification + harness flag compiler | `packages/policy/src/{classify,compile}.ts`, `contracts/src/domain/compiled-policy.ts` | `policy/test/{classify,compile}.test.ts` | `bba331f` |
| AEOS-P2.M1.T3 daemon-side enforcement + approvals endpoints | `packages/policy/src/{guard,registry}.ts`, `packages/api/src/{policy-gate,routes/approvals}.ts` | `api/test/enforcement.test.ts`, `policy/test/guard.test.ts` | `24ca36c` |
| AEOS-P2.M1.T4 approval flow e2e incl. timeout-deny | aeosd `api-module.ts` wiring, `packages/sdk/src/client.ts` | `apps/aeosd/test/approval-flow.e2e.test.ts` | `a623675` |
| AEOS-P2.M1.T5 approvals inbox + notification hook | `apps/ade/src/ApprovalsPanel.tsx`, `AgentView.tsx` | `apps/ade/test/ade.spec.ts` (Playwright T2b) | `44e3099` |
| AEOS-P2.M2.T1 budget meter + scheduler hard-stop | `packages/policy/src/{budget-meter,objective-file}.ts`, contracts budget events | `policy/test/budget-meter.test.ts` | `85b21c2` |
| AEOS-P2.M2.T2 resume-with-increase | aeosd objectives-route wiring, `packages/sdk/src/client.ts` | `apps/aeosd/test/budget-resume.e2e.test.ts` | `73a79ac` |
| AEOS-P2.M2.T3 append-only audit appender | `packages/kernel/src/audit/audit.ts`, memory propose onEvent hook | `kernel/test/audit.test.ts` | `a6ed339` |
| AEOS-P2.M3.T1 age secret store CRUD | `packages/secrets/src/store.ts`, aeosd resolver fallback | `secrets/test/store.test.ts` | `7dceaa4` |
| AEOS-P2.M3.T2 policy-gated env injection | contracts `AgentConfig.secrets`, `packages/api/src/policy-gate.ts` injection | `api/test/injection.test.ts` | `2a018fe` |
| AEOS-P2.M3.T3 pipeline-wide redaction filter | `packages/kernel/src/bus/redact.ts`, daemon boot/resolver registration | `kernel/test/redact.test.ts`, `apps/aeosd/test/canary-leak.e2e.test.ts` (M3 exit gate) | `b00fb2d` |
| AEOS-P2.M4.T1 curator scaffold + idle trigger + dry-run | `packages/memory/src/curator.ts` (scan/dry-run/isCuratorDue), aeosd `daemon.ts` opt-in module | `memory/test/curator.test.ts`, `apps/aeosd/test/curator-trigger.e2e.test.ts` | `4bd9012` |
| AEOS-P2.M4.T2 aging/dedup/summarize via memory.propose | `curator.ts` passes 1–2 (consolidation, dedup) + apply path over `enqueueProposal`/`applyProposals` | `memory/test/curator.test.ts` (T2 block) | `d61e857` |
| AEOS-P2.M4.T3 own audit trail + never-delete guarantee | `CuratorPathError` root guard; trail assertions; byte-multiset proof | `memory/test/curator-guarantees.test.ts`, e2e full-loop case (M4 exit gate) | `c4eb850` |
| AEOS-P2.M5.T1 runner PTY allocation | `runner/src/protocol/{messages,client}.ts` pty messages, `runner/src/runner/runner.ts` shell lifecycle + metadata pty.log | `runner/test/pty.test.ts` (coherence, single-shell, metadata-only) | `2b2312e` |
| AEOS-P2.M5.T2 WS attach + xterm tab | `api/src/routes/attach.ts` (allow-tier gate), supervisor PtyBridge seam, `apps/ade/src/TerminalPanel.tsx` | `api/test/attach.test.ts`, `apps/ade/test/ade.spec.ts` T5 (Playwright) | `ec3ea46` |
| AEOS-P2.M5.T3 co-edit guard + ADR-009 | `policy/src/co-edit.ts`, scheduler `watchedRepo` option, `docs/adr/ADR-009-co-edit-guard.md` | `policy/test/co-edit.test.ts`, `scheduler/test/co-edit-guard.test.ts` | `fceb790` |

Verified 2026-07-14 by direct run on `main` after the M2 merge (code-as-truth):
install → build → typecheck → test (69/69 across contracts/kernel/aeosd) →
depcruise (103 modules) → schema-drift, all green; `aeosd reindex` binary
smoke-tested against a scratch `AEOS_HOME`.

Verified 2026-07-18 on `feat/aeos-p1-m3-runner` at M3 exit: CI-identical
chain green — 100/100 tests across 20 files (contracts/kernel/runner/aeosd),
depcruise clean (138 modules).

Verified 2026-07-20 on `main` at the `v0.1.0` tag: CI-identical chain green
twice consecutively (flake check) — 211 tests across 43 files, depcruise
clean (317 modules), plus the ADE Playwright suite (4 specs) and the
daemon E2E (golden path 10×, kill switch) run separately in CI. A fresh
`git clone` → `pnpm install --frozen-lockfile` → `pnpm build` → boot
`aeosd` → drive the full CLI workflow was verified manually against the
exact README quickstart commands before tagging.

Verified 2026-08-25 at `c6b2600` on `overnight/2026-08-24` (cold-pickup
reconciliation sweep): CI-identical chain green — 287 vitest passed /
2 skipped (env-gated smokes, docker-runnable per S07) across 61 files,
depcruise clean (389 modules, 1213 dependencies); ADE Playwright 5/5 run
first-hand in the same sweep; golden-path E2E (SIGKILL+resume ×10, kill
switch) inside the vitest run. Task-ID↔checkbox invariant clean across all
107 ROADMAP tasks (59 checked).

Verified 2026-08-25 at `c4eb850` on `overnight/2026-08-24` (P2.M4 exit):
CI-identical chain green — 313 vitest passed / 2 skipped across 64 files,
depcruise clean. Exit gate evidence: deterministic (identical proposal
lists across scans), audited (append-only UTC-split curator trail +
first live `memory.written` rows in the main audit), lossless (pre-run
byte multiset fully contained post-run). Invariant rescan: 62 checked,
0 violations.

Verified 2026-08-25 at `fceb790` on `overnight/2026-08-24` (P2.M5 exit):
CI-identical chain green — 327 vitest passed / 2 skipped across 69 files,
depcruise clean; ADE Playwright 6/6 including the takeover loop (attach →
type → echo → release → headless). Exit gate: mid-session human takeover
and clean handback demonstrated end-to-end; co-edit pause proven by the
scheduler integration test. Invariant rescan: 65 checked, 0 violations.

## Deployment

None yet by design — P1 ships a local daemon; CI (M1.T6) plus the nightly
secret-gated live-harness workflow (M9.T2) are the only pipelines until
P4 deploy targets.
