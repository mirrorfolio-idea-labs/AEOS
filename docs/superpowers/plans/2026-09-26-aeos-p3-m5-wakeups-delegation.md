# AEOS P3.M5 — Scheduler Wakeups + Delegation

## Design

### T1 — durable wakeups (spec §12)
- A job is a file: `<home>/jobs/<id>.yaml` (`JobSchema` in
  `scheduler/src/wakeups.ts`), `kind: cron` (5-field, **UTC**, validated
  with `cron-parser` — pre-approved dependency) or `kind: idle` (`idleMs`,
  optional `minIntervalMs`). Actions: `start-objective {workspaceId,
  agentId, objectiveId}` or `curator` (dry-run pass over every agent —
  generalizes the P2.M4 idle trigger).
- `isJobDue`: cron is due when the first slot after `lastRunAt ??
  createdAt` has passed, so any number of slots missed while the daemon was
  down fire **once** (no catch-up storm). Idle is due when the daemon has
  had no running objective for `idleMs` and `minIntervalMs` has passed.
- `createWakeupScheduler` ticks every `AEOS_WAKEUP_TICK_MS` (default 30 s),
  first tick at boot. `lastRunAt` is persisted **before** the action runs
  (at-most-once per slot even if the daemon dies mid-action); an action
  error is kept as `lastError`. A hand-broken job file is skipped, never
  fatal.
- Surface: `GET/POST /v1/jobs`, `DELETE /v1/jobs/:id` (400 on invalid
  cron, unknown agent rejected); SDK `listJobs/saveJob/deleteJob`; CLI
  `aeos job add|list|rm`. Daemon module `wakeups` (only with the API).

### T2 — delegation
- Plan grammar already carries `@agent` (P3.M1). A delegated task runs **as
  that agent**: its own policy (`policyFor`), routing and credential
  profile, in the objective owner's worktree (so it sees prior work and
  integrates via git + plan only). The task commit is authored by the
  delegate (`<id>@agents.aeos.local`) with "(delegated by <owner>)" in the
  body. The brief tells the delegate who delegated.
- An unknown delegate is a 409 before anything spawns.

## Verification
- `scheduler/test/wakeups.test.ts`: validation, cron due, missed slots fire
  once, lastRunAt-before-action + lastError, idle + min interval, broken
  file skipped.
- `aeosd/test/wakeup-restart.e2e.test.ts` (**T1 accept**): real daemon,
  job created via SDK, daemon SIGKILLed, two slots missed, restart → job
  fires once and the objective completes.
- `api/test/delegation.test.ts` (**T2 accept**): two-agent objective, the
  `@reviewer` task runs as the reviewer in the same worktree, commit
  authored by it; unknown delegate refused.
