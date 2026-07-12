# Traceability — requirements → design → implementation → testing → deployment

> **Generated view** — as of `6c8858e`, 2026-07-13. Regenerate per
> [README R3](README.md). Spec = `docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`.

## Requirements → milestones (design coverage)

Every spec section maps to at least one milestone (source: ROADMAP context briefs).

| Spec section | Covered by |
|---|---|
| §1–§4 thesis, decisions, overview | all of P1 (golden-path exit gate) |
| §5 repo structure, §6 kernel contracts | M1 (contracts, boundaries), M2 (kernel) |
| §7 domain model | M1.T3 (schemas), M2 (store/registry), M6 (objective/plan/checkpoint) |
| §8 memory system | M5 |
| §9 provider layer + BYOK credential profiles | M4 |
| §10 execution engine | M3 |
| §11 security & policy | **P2** (deferred by design; kill switch only in M9.T3) |
| §12 scheduler/planner | M6 (v0), P3 (full autonomy) |
| §13 cost-aware routing | P3 |
| §14 API + UI | M7, M8 |
| §15 plugins | P4 |
| §16 deployment | P4 (CI-only in P1 via M1.T6) |
| §17 pre-mortem | mitigations distributed across M2–M9 accept criteria |
| §18 testing strategy | every task's accept; end-to-end in M9 |
| §19 build decomposition | ROADMAP itself |
| §20 open questions | tracked in spec; promote to tasks when they block |

## Implemented work (task → code → tests → commit)

| Task | Code (packages/contracts) | Tests | Commit |
|---|---|---|---|
| AEOS-P1.M1.T1 scaffold | root workspace files, `package.json`, `tsconfig.json` | `test/smoke.test.ts` | `a76db81` |
| AEOS-P1.M1.T2 envelope + ULID ids | `src/envelope.ts`, `src/ids.ts`, `src/version.ts` | `test/envelope.test.ts` | `b4bcfcf` |
| AEOS-P1.M1.T3 domain schemas | `src/domain/{workspace,agent,credential,session,objective}.ts` | `test/domain.test.ts` | `82157f3` |
| AEOS-P1.M1.T4 event taxonomy | `src/events/taxonomy.ts` | `test/events.test.ts` + `test/fixtures/events.golden.ndjson` | `09e506e` |
| AEOS-P1.M1.T5 JSON Schema export | `scripts/gen-schemas.ts`, `schemas/*.json` | `test/schema-drift.test.ts` | `6c8858e` |
| AEOS-P1.M1.T6 boundaries + CI | *(open)* `.dependency-cruiser.cjs`, `.github/workflows/ci.yml` | depcruise RED/GREEN check | — |

Verified 2026-07-13 by direct run (code-as-truth): `pnpm test` → 5 files, 17
tests, all green.

## Deployment

None yet by design — P1 ships a local daemon; CI (M1.T6) is the only pipeline
until P4 deploy targets.
