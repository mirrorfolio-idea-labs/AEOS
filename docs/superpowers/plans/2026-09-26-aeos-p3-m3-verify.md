# AEOS P3.M3 — Verification Task Type

## Design

- **Contracts (additive):**
  - `RepoBinding.verify?: string[]` sets the verification commands for a
    repository.
  - `Objective.verify?` overrides them; `[]` disables verification.
  - `Checkpoint.verification` (added in P3.M1) records
    `{outcome: pass|fail|flaky, commands[]}`.
- **Runner** (`scheduler/src/verify.ts` `runVerification`):
  - Commands run in order through `sh -c` in the worktree, with `CI=1`.
  - A failing command is retried once. A fail followed by a pass on retry
    is `flaky`: it does not block, but it is recorded.
  - Execution stops at the first real failure and keeps a 4 KB output tail.
  - Each command has a timeout (10 minutes by default). On timeout the
    whole process group is SIGKILLed.
  - With no commands the result is `fatal`, which blocks at once with a
    clear message.
- **Scheduler:** `verify` tasks call `runVerify` instead of spawning a
  harness session.
  - Pass or flaky: the task completes.
  - Fail: the verify task takes a strike, and the nearest earlier
    implement/refactor/rename task is **re-opened** (attempts reset, fresh
    session). `onVerifyFailed` writes the failure into its
    `tasks/<id>.md` notes, which the session brief carries.
  - Three strikes: the verify task is blocked, the objective pauses behind
    an `approval.request`, and later tasks never run.
- **Planner:** when verification commands exist and the objective has a
  worktree, `interleaveVerify` inserts `V<n> [verify]` after every code
  task.
- **Surfaces:** `bindRepo {verify}`, `createObjective {verify}`, and
  CLI `--verify`.

## Found and fixed along the way

The objective status endpoint read `plan.md` first and evaluated `running`
last. If a run finished in between, the endpoint returned `running:false`
with a plan read mid-run.
- It showed up as a roughly 1-in-12 flake in the new test. Instrumentation
  showed the checkpoint completed while `plan.md` was stale.
- Fix: snapshot `running` before reading the files.
- Result: 0 failures in 30 runs. The ADE and CLI pollers had the same
  exposure.

## Verification

- `api/test/verify.test.ts`:
  - runner pass/fail/flaky and fatal;
  - timeout kills the process group;
  - fail → re-open with notes → fix → pass → the plan proceeds;
  - **exit gate: a persistent failure blocks after 3 strikes and later tasks
    never run**;
  - **generated plans interleave verify tasks**;
  - a verify task with no worktree blocks immediately.
- Full bar: 408 passed / 2 skipped.
