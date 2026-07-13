# CLAUDE.md — ADE / AEOS

AEOS (Autonomous Engineering Operating System) is a local-first daemon that
runs durable, resumable AI coding agents whose entire state lives as files;
ADE is its web UI. Full design:
`docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`.

## Start here (any agent, any session)

1. **`docs/pm/BOARD.md`** — current status, active sprint, drift register.
2. **`docs/ROADMAP.md`** — the drift anchor: stable task IDs (`AEOS-P<p>.M<m>.T<t>`), accept criteria, status markers. This file owns build-task status.
3. **`docs/pm/README.md`** — the PM operating manual (source-of-truth map, sync rules R1–R6, delegation protocol). Follow it for every change.
4. Picking up a task? Its card is in `docs/pm/tasks/`; step-level detail is in the milestone plan under `docs/superpowers/plans/`.

**Fact-checking rule:** docs describe intent; the code and git history are the
facts. On any inconsistency or doubt, trust the code, fix the doc, and log it
in the BOARD drift register.

## Architecture (one paragraph)

pnpm monorepo. `packages/contracts` is the dependency root: Zod schemas for
the event envelope, domain objects (Workspace/Agent/CredentialProfile/Session/
Objective/PlanTask/Checkpoint), and the canonical event taxonomy, exported
also as JSON Schema (`schemas/*.json`, drift-tested). Later packages (kernel,
provider, memory, scheduler, API, UI) may only import each other's published
entry points — dependency-cruiser enforces this.

## Build, test, run

- Node 22 (`.nvmrc`), pnpm 9, ESM, strict TS, Vitest.
- `pnpm install` · `pnpm build` · `pnpm test` (workspace-wide) · `pnpm -F @aeos/contracts gen:schemas` (regenerate JSON Schemas — commit the output).
- CI-identical chain: `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise` (last two exist from task AEOS-P1.M1.T6 onward).

## Conventions

- Conventional commits; every commit advancing a build task ends its subject with the task ID: `feat(contracts): event envelope [AEOS-P1.M1.T2]`.
- The commit that completes a task flips its ROADMAP checkbox in the same commit (PM rule R1).
- Milestone plans are written just-in-time, only after the previous milestone's exit gate passes.
- No cross-package internal imports; schemas change only with regenerated `schemas/*.json`.
