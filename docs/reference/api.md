# API reference

<!-- Generated from packages/api/openapi.json by `pnpm -F @aeos/api gen:reference`.
     Do not edit by hand: CI fails when this page and the API disagree. -->

Local-first API over the AEOS daemon. Envelope: { success, data, error, meta }. The daemon serves it at
`http://127.0.0.1:7777` by default. When a token is set, every `/v1` request
needs `Authorization: Bearer <token>`. The full machine-readable spec is
[`packages/api/openapi.json`](../../packages/api/openapi.json).

Sections: [general](#general) · [workspaces](#workspaces) · [agents](#agents) · [objectives](#objectives) · [stop](#stop) · [runtime](#runtime) · [jobs](#jobs) · [memory](#memory) · [events](#events) · [approvals](#approvals)

## general

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/v1/health` | — | Liveness + AEOS_HOME identity. |

## workspaces

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/v1/workspaces` | — | List workspaces. |
| `POST` | `/v1/workspaces` | — | Create a workspace. |
| `GET` | `/v1/workspaces/{id}` | — | Get one workspace. |

## agents

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/v1/agents` | — | List agents in a workspace. |
| `POST` | `/v1/agents` | — | Create an agent (registry-backed, git-initialized). |
| `GET` | `/v1/agents/{id}` | — | Get one agent. |
| `POST` | `/v1/agents/{id}/credential-profile` | — | BYOK on-the-go switch (spec §14): point the agent at another credential profile; takes effect next spawn. |
| `POST` | `/v1/agents/{id}/repos` | — | Bind a repository (spec §7): objectives targeting it run in their own git worktree on an aeos/<agent>/<objective> branch — never in the checkout itself. |
| `DELETE` | `/v1/agents/{id}/repos/{repoId}` | — | Unbind a repository. Existing worktrees and agent branches are left in place. |

## objectives

| Method | Path | Query | Description |
|---|---|---|---|
| `POST` | `/v1/objectives` | — | Create an objective with its plan.md. |
| `POST` | `/v1/objectives/{id}/start` | — | Start (or resume) the objective through the sequential scheduler. Idempotent while running. |
| `GET` | `/v1/objectives/{id}/routes` | — | Router decisions + realized cost per task attempt (routes.ndjson, P3.M2). |
| `POST` | `/v1/objectives/{id}/plan/approve` | — | Human approval of a planner-proposed plan (plan.proposed.md → plan.md), then start. Works after a denial or expiry too. |
| `GET` | `/v1/objectives/{id}` | — | Objective status derived from plan.md + checkpoints (files are truth). |
| `GET` | `/v1/objectives/{id}/diff` | — | Unified diff of the objective worktree: uncommitted \| branch (since the objective began) \| last-commit. |
| `POST` | `/v1/objectives/{id}/review` | — | Send review comments back to the agent: appends an R<n> task to plan.md with the comments as its notes, then (by default) starts the objective. |

## stop

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/v1/stop` | — | Kill-switch status. |
| `POST` | `/v1/stop` | — | Engage the kill switch: creates <AEOS_HOME>/STOP. Running tasks finish their current session; nothing new spawns (spec §18). |
| `DELETE` | `/v1/stop` | — | Lift the kill switch (removes the STOP file). |

## runtime

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/v1/agents/{id}/status` | — | Current attention status of one agent (idle \| working \| blocked \| done \| unknown). |
| `GET` | `/v1/agents/{id}/wait` | — | Long-poll until the agent reaches one of `until` (default blocked,done). Pass `afterSeq` (from a prior status read) to require a NEW transition — race-free act-then-wait. |
| `GET` | `/v1/inbox` | — | Every agent, attention-sorted: blocked → finished-unseen → working → idle → settled. |
| `POST` | `/v1/agents/{id}/attention` | — | Triage: seen (clear unseen), unread (force unseen), settle (sink until new activity), unsettle. |

## jobs

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/v1/jobs` | — | List durable wakeup jobs (cron + idle). |
| `POST` | `/v1/jobs` | — | Create or replace a wakeup job. Cron is 5-field, UTC. |
| `DELETE` | `/v1/jobs/{id}` | — | Delete a wakeup job. |

## memory

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/v1/memory/index` | — | MEMORY.md index + budgets (lazily initialized). |
| `GET` | `/v1/memory/file` | — | Read one memory file by repo-relative path. |
| `GET` | `/v1/memory/search` | — | FTS search over the agent memory (rebuilds lazily). |
| `GET` | `/v1/memory/proposals` | — | Queued memory proposals (retrospective, curator, agents) awaiting acceptance. |
| `POST` | `/v1/memory/proposals/apply` | — | Accept queued proposals (all, or `ids`) — they take effect in the NEXT session snapshot (spec §8 rule 2). |
| `POST` | `/v1/memory/proposals/{id}/reject` | — | Reject (drop) one queued proposal; memory is untouched. |

## events

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/v1/events` | — | Canonical event stream (SSE) with filters + backfill. |

## approvals

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/v1/approvals` | — | Pending approval requests (spec §11 approvals flow). |
| `POST` | `/v1/approvals/{requestId}` | — | Answer a pending approval. Unanswered requests deny on expiry. |
