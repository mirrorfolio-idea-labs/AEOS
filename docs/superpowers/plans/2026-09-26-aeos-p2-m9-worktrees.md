# AEOS P2.M9 — Repository Bindings, Worktrees + Session Brief

> **For agentic workers:** full green bar before every commit; the
> completing commit flips the ROADMAP checkbox.

**Why this milestone exists:** the P2.M7 sweep found that spec §7/§10 were
never wired up.
- Agents had no repository bindings.
- Harnesses ran in their hermetic profile directory, not a git worktree.
- Sessions received only the bare task title: no objective, no definition of
  done, no memory snapshot, even though spec §8 rule 2 requires the snapshot.

A coding agent is not customer-ready without these, and the herdr-derived
review pane (herdr-reviewr, MIT) needs a worktree to diff.

## Design

- **Contracts (additive, schemas regenerated).**
  - `RepoBindingSchema {id, path, baseRef?}` and `AgentConfig.repos?`.
  - `Objective.repo?`.
  - `SpawnOptions.workdir?`.
- **Worktrees** (`scheduler/src/worktree.ts`):
  - `ensureObjectiveWorktree` creates one worktree per (agent, repo,
    objective) at `<agent>/worktrees/<repo>/<objective>` on branch
    `aeos/<agent>/<objective>`. It is idempotent, so a resume re-attaches.
  - `commitTaskWork` commits everything the task left behind, authored by the
    agent. The sha lands in `checkpoint.commit`.
  - `worktreeDiff` diffs by scope: `branch` (merge-base with the base),
    `last-commit`, and `uncommitted` (including untracked files).
- **Scheduler.** New `workdir`, `composePrompt` and `commitTask` hooks. The
  defaults preserve the old behaviour exactly.
- **Adapters.** `RunChild` gains `workdir`, and the process cwd is the
  worktree.
- **Session brief** (`api/src/brief.ts`), in order:
  1. The task title.
  2. `tasks/<id>.md` notes.
  3. The AEOS context block: objective, definition of done, plan position,
     later tasks, the worktree/branch and its rules.
  4. `composeSnapshot` memory.

  It contains no timestamps, so it is byte-stable.
- **API.**
  - `POST/DELETE /v1/agents/:id/repos`: binding requires an absolute path
    that is a git repo.
  - `objectives` create accepts `repo` (validated against the bindings) and
    `definitionOfDone`, and always writes `objective.yaml`.
  - `GET /v1/objectives/:id/diff?scope=`.
  - `POST /v1/objectives/:id/review` appends `R<n>` to plan.md, writes the
    comments to `tasks/R<n>.md`, and restarts the objective.
- **SDK/CLI.** SDK methods `bindRepo`, `unbindRepo`, `objectiveDiff` and
  `reviewObjective`. CLI commands `aeos repo bind|unbind`,
  `aeos objective diff|review`, and `objective create --repo --done`.
- **ADE.**
  - A Review tab with repository binding, a diff viewer with scopes, click a
    line to comment, and send the batch to the agent.
  - A repo picker on the new-objective form.
  - App keeps the selected agent in sync after changes.

## Co-edit guard (ADR-009)

It stays unwired. Agent output in the worktree is only committed after the
session ends, so the guard's "uncommitted counts as foreign" rule would trip
on every task. Worktree isolation also makes a co-edit a deliberate act: the
human has to open the agent's worktree. Activating the guard needs per-path
attribution, which is follow-up work.

## Verification

- `api/test/worktrees.test.ts`:
  - Worktree isolation: the checkout stays untouched and each task produces
    an agent-authored commit.
  - Brief content.
  - Diff scopes and the review round-trip.
- `api/test/brief.test.ts`: memory snapshot injection and byte stability.
- ADE Playwright T6: bind → run → approve → diff → comment → send → R1.
- Full bar: 362 passed / 2 skipped across 76 files; Playwright 7/7.
