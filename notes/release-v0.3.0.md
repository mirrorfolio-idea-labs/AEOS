# AEOS v0.3.0 — Autonomy

Everything since `v0.2.0`. **Phase P3 exit gate: green**
(`apps/aeosd/test/p3-exit.e2e.test.ts` — an unattended run on the real daemon).

## Highlights

- **Planner with task classes** (P3.M1).
  - Plans carry `[class]` (plan, architect, implement, refactor, review,
    security_review, summarize, docs, rename) and optional `@agent`.
  - `autoPlan` objectives get a plan from a read-only planner session. The
    new `run_plan` policy tier decides whether it runs at once (allow),
    waits for approval in the inbox (confirm, the default) or stays a
    proposal (deny).
- **Cost-aware model router** (P3.M2).
  - A new `@aeos/router` package with a pricing index (refreshed daily,
    stale-but-served offline).
  - Layered `routing.yaml` maps each class to a provider, model and thinking
    budget. By default frontier classes use Opus, implement uses Sonnet and
    summaries and docs use Haiku.
  - Every decision is audited (`route.decided`), with realized cost per
    task in `GET /v1/objectives/:id/routes`.
- **Verification gates progression** (P3.M3).
  - `verify` tasks run the repo's commands in the worktree and report pass,
    fail or flaky.
  - A failure re-opens the code task with the failing output; three
    strikes block the plan.
  - Verify tasks are interleaved automatically when verification is
    configured.
- **Self-learning loop** (P3.M4).
  - After each objective a deterministic retrospective turns verification
    failures, re-dos and your review comments into `lessons/`,
    `mistakes/` and `preferences/` proposals.
  - Accept or reject them from the ADE, CLI or API, or set
    `retrospective: apply` for unattended runs.
  - The next session's brief carries accepted proposals byte for byte.
- **Scheduled work** (P3.M5).
  - Durable cron (UTC) and idle jobs live as files in `<home>/jobs`, so they
    survive restarts; a slot missed while the daemon was down fires once.
  - Use `aeos job add|list|rm` or `/v1/jobs`.
- **Delegation** (P3.M5).
  - A `@reviewer` task runs as that agent, under its own policy, routing and
    profile, in the owner's worktree.
  - Its commit is authored by the delegate.

## Fixes worth knowing

- A race in the objective status endpoint could briefly report a finished
  run as still running with stale files. The endpoint now takes a snapshot
  before reading.
- A default-posture planner could park on its own tool call. Planning now
  runs read-only.

## Upgrade notes

- All contracts changes are additive:
  - `PlanTask.taskClass` (defaults to `implement`) and `PlanTask.agent`;
  - `Objective.verify`, `Objective.retrospective`, `RepoBinding.verify`;
  - `Checkpoint.verification`;
  - the `route.decided` event.
- Old plans parse unchanged.
- New optional dependency: `cron-parser`.
- `AEOS_WAKEUP_TICK_MS` sets the scheduler tick (default 30 s).

## Known limits / still open

- The Claude and OpenCode live smokes are manual (P1.M4, P1.M10).
- Objective-run sessions do not yet write `transcript.ndjson` (they
  are tracked for P4 hardening).
- Desktop installers are unsigned; signing lands in P5.M3.
