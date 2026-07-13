# AEOS-P1.M2.T1 — `AEOS_HOME` layout + atomic writes + YAML codecs

> Delegation-ready card. Status is owned by `docs/ROADMAP.md` — this card
> carries a snapshot only.

| Field | Value |
|---|---|
| Epic / Milestone | P1 / M2 (kernel) |
| Sprint | S02 |
| Status (snapshot — verify at source) | `[~]` in execution |
| Priority | P0 (first M2 task; T2–T5 depend on it) |
| Owner | SDD implementer subagent |
| Depends on | M1 (done, on `main`) |
| Blocks | M2.T2–T5 |

## Objective
Build `packages/kernel`'s foundation: typed `AEOS_HOME` path helpers + dir
skeleton, crash-safe atomic file writes, and Zod-validated YAML codecs for
`agent.yaml`/`session.yaml`.

## Repo context (cold-start)
pnpm 9 / Node 22 ESM monorepo; `packages/contracts` provides all schemas.
Verify chain: `pnpm install && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`.
Branch: `feat/aeos-p1-m2-kernel`.

## Execution detail
[M2 plan — Task 1](../../superpowers/plans/2026-07-13-aeos-p1-m2-kernel.md#task-1-aeos_home-layout--atomic-writes--yaml-codecs--aeos-p1m2t1)
plus the plan's Global constraints section (config pattern copied from
`packages/contracts`, `yaml@^2` dependency, explicit `home` argument, temp-dir
tests only).

## Acceptance criteria
ROADMAP M2.T1: "crash-simulating test (kill between tmp write and rename)
never leaves corrupt state." (source: `docs/ROADMAP.md`)

## Verification
`pnpm -F @aeos/kernel test` green incl. 100× crash-simulation loop; full CI
chain green; commit `feat(kernel): AEOS_HOME layout, atomic writes, YAML codecs [AEOS-P1.M2.T1]`
flips the ROADMAP checkbox.

## Out of scope
SQLite (T2), registry/git (T3), bus (T4), daemon (T5). No changes to
`packages/contracts`.
