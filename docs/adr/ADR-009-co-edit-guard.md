# ADR-009: Co-edit guard for agent-owned trees

**Status:** Accepted (2026-08-25) · **Resolves:** spec §20 OQ1 · **Task:** AEOS-P2.M5.T3

## Context

An agent works in a git tree it owns (the agent directory today — itself a
git repo per M2; per-objective `worktrees/<repo>/<branch>` once populated).
A human may edit that same tree mid-task — fixing a typo while reading,
hot-fixing during review, or outright taking over. Uncoordinated concurrent
mutation of the same tree is exactly the failure mode the worktree isolation
model exists to prevent, and the question (OQ1) asked how to resolve it.

## Decision

**Detect-and-pause. The agent never reconciles foreign edits itself.**

The scheduler snapshots `git status --porcelain` of the watched repo before
each task session and again after the session reports success
(`worktreeStatus` / `diffStatuses`, `packages/policy/src/co-edit.ts`). Any
path that differs between the two snapshots pauses the objective with an
`approval.request` (`action: objective.resume`, detail naming the paths) —
kill-switch semantics: no plan mutation, no 3-strike consumption; re-running
on a clean tree resumes at the same task.

Baseline rules:

- Everything already dirty when the task starts is *known state* and never
  trips the guard.
- Gitignored files are invisible by construction (`--porcelain` shows only
  tracked changes plus untracked-not-ignored).
- Agent work is expected to be committed or checkpointed by the task flow;
  uncommitted agent output counts as foreign by this rule — deliberate v0:
  false positives are safe (a human answers), false negatives are not.

Rejected alternatives:

- **Ignore it** — silently interleaved human/agent writes are how corrupted
  trees happen; the whole point is to surface them.
- **Auto-stash / auto-rebase** — the agent rewriting or shelving a human's
  in-flight work is data loss with extra steps.
- **Lock the tree against humans** — hostile to the operator who owns the
  machine; takeover must remain possible, not forbidden.

## Activation status (deliberate)

The guard ships as scheduler machinery (`watchedRepo` on `runObjective`)
but is **not enabled by any daemon path yet**: today's watched candidate —
the agent dir — contains scheduler-written `objectives/` state, which would
trip constantly. Activation lands with real per-objective worktrees
(populated `worktrees/<repo>/<branch>`), where agent output is committed and
the objective bookkeeping lives elsewhere. Until then the accept criterion
is proven by the scheduler integration test
(`packages/scheduler/test/co-edit-guard.test.ts`).

## Consequences

- Human edits can no longer be silently overwritten mid-task once a watcher
  is attached; they pause the world instead.
- Pause/resume round-trips through the existing approvals inbox (P2.M1.T5)
  — no new UI surface.
- When worktrees arrive, enabling the guard is one wiring change: pass the
  active worktree path as `watchedRepo`.
