# Traceability — requirements → design → implementation → testing → deployment

> **Generated view** — as of merge `8506974` (M1 exit), 2026-07-13. Regenerate per
> [README R3](README.md). Spec = `docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`.

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

Verified 2026-07-13 by direct run on `main` @ `8506974` (code-as-truth):
install → build → typecheck (src+test+scripts) → test (19/19) → depcruise →
schema-drift, all green.

## Deployment

None yet by design — P1 ships a local daemon; CI (M1.T6) is the only pipeline
until P4 deploy targets.
