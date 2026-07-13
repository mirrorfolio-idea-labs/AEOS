# AEOS-P1.M1.T6 — Boundary enforcement (dependency-cruiser) + CI pipeline

> Delegation-ready card. Status is owned by [`docs/ROADMAP.md`](../../ROADMAP.md)
> — verify there before starting.

| Field | Value |
|---|---|
| Epic / Milestone | P1 — Spine / [M1 — Monorepo scaffold + contracts](../../ROADMAP.md#m1--monorepo-scaffold--contracts-package--) |
| Sprint | [S01](../sprints/S01.md) |
| Status (snapshot 2026-07-13 — verify at source) | `[~]` in progress — plan step 1 done (`13035e9`), steps 2–5 remain |
| Priority | P0 — gates the M1 exit |
| Owner | any agent |
| Depends on | T1–T5 (all done: verified 17/17 tests green @ `6c8858e`) |
| Blocks | PM-S01-1 (merge to main), M1 exit gate, M2 |

## Objective

Add dependency-cruiser boundary rules (no package may import another package's
internals) and a GitHub Actions CI pipeline running install → build →
typecheck → test → depcruise → schema-drift check.

## Repo context (cold-start)

- pnpm monorepo (pnpm 9, Node 22 — see `.nvmrc`), ESM, strict TypeScript, Vitest.
- Work on branch `feat/aeos-p1-m1-contracts`.
- Only one package exists: `packages/contracts` (`@aeos/contracts`). `apps/` does not exist yet — the depcruise script must not fail because of that (scope the globs or create the dir when needed).
- Verify baseline before starting: `pnpm install && pnpm test` → currently 5 files / 17 tests green.

## Execution detail

Follow the plan exactly:
[M1 plan → Task 6](../../superpowers/plans/2026-07-13-aeos-p1-m1-contracts.md#task-6-boundary-enforcement--ci--aeos-p1m1t6)
(steps 1–5: config → prove the rule bites with a throwaway violation → CI
workflow → run CI chain locally → commit and flip ROADMAP markers).

**Mid-task state (2026-07-13, verified by direct run):** commit `13035e9`
landed step 1 (`.dependency-cruiser.cjs` + devDep + script), but
`pnpm depcruise` currently **fails** — the script globs `packages apps` and
`apps/` doesn't exist yet (drift D6). Resume at step 2 after fixing the glob
(scope to `packages`, or make it tolerate the missing dir). Steps 2–5 (RED/
GREEN proof, CI workflow, local chain, commit + flip T6 `[x]`) are all open.

Deviations to be aware of:
- Plan step 5 says to mark M1 `[x]` in the same commit. Note the exit gate
  wording is "CI green on **main**" — flipping task T6 `[x]` in this commit is
  correct; the **milestone** flip is owned by [PM-S01-2](../sprints/S01.md)
  after the merge (PM-S01-1). Flip T6 only.
- `pnpm typecheck` must exist as a root script for the CI chain; if it doesn't,
  add it (workspace-recursive `tsc --noEmit` or equivalent) as part of step 3.
- While adding the CI workflow, swap the README's hardcoded "17/17 tests green"
  badge for a real CI status badge (drift D7).

## Acceptance criteria

From `docs/ROADMAP.md` (source of truth):

> *Accept: CI green; a deliberate cross-internal import fails depcruise locally.*

## Verification

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise
```
All green; plus the RED test from plan step 2 (throwaway `packages/scratch`
violation makes `pnpm depcruise` exit non-zero, then is deleted).

## Out of scope

- Anything in M2+ (no `apps/aeosd`, no kernel code).
- Changing any existing schema/test in `packages/contracts`.
- Merging to `main` (that's PM-S01-1, needs Kabeer).
- Fixing deferred review minors (that's PM-S01-3).

## Commit format

`ci: boundary enforcement + CI pipeline [AEOS-P1.M1.T6]`
