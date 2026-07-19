# AEOS P1.M6 — Objective/Plan/Checkpoint Loop (scheduler v0) — Implementation Plan

> **Cold-start brief.** Spec §7, §12 — the heart of P1. Package
> `packages/scheduler` (`@aeos/scheduler`), deps: contracts + kernel +
> provider-core entry points. Files are truth: `objective.md`, `plan.md`
> (checkbox grammar, stable task IDs), `checkpoints/<task>.yaml`.
> Branch `feat/aeos-p1-m6-scheduler`. TDD; ROADMAP flips per task (R1).

## Decisions (recorded here, drift-logged if changed)

- `Checkpoint` contract gains optional `attempts` (int, default 0) so the
  3-strike counter survives restarts — additive, schemas regenerated.
- Plan grammar: `- [<marker>] **<ID>** <title>` where marker ∈
  `' '|x|~|!` ↔ pending/completed/in_progress/blocked. Parser is tolerant
  (extra spaces, missing bold, `T1:` form) and preserves all non-task
  lines verbatim so human edits round-trip.
- T4's ROADMAP accept says "SIGKILL daemon" — the daemon-level kill test
  is M9's golden path. Here, crash-resume is proven at the scheduler
  boundary: abort mid-task, construct a FRESH scheduler over the same
  files, plan completes without re-running completed tasks. Logged as an
  R4 deviation to clear in M9.

### Task 1: Plan file parser/writer  `[AEOS-P1.M6.T1]`
`src/plan.ts` — parse/serialize with verbatim non-task lines; status
marker mapping; property-based round-trip (seeded LCG generator) +
hand-mangled fixtures.

### Task 2: Checkpoint store + recovery resolver  `[AEOS-P1.M6.T2]`
`src/checkpoint.ts` — atomic YAML read/write under
`checkpoints/<taskId>.yaml`; `resolveNextTask(plan, checkpoints, maxAttempts)`
→ `{kind:'run'|'done'|'paused'}` — first non-completed task wins; blocked
checkpoint (or attempts ≥ max) pauses the objective; checkpoints override
stale plan markers (files may disagree after a crash — checkpoints are
the later truth; plan is rewritten to match).

### Task 3: Sequential scheduler loop  `[AEOS-P1.M6.T3]`
`src/scheduler.ts` — `runObjective`: resolve → mark in_progress (plan +
checkpoint) → spawn via any `HarnessAdapter` → drain events →
completed ⇒ checkpoint completed (costs + resume token) / failed ⇒
attempts+1 with injectable backoff; 3rd strike ⇒ blocked + paused +
emitted event (injectable `onEvent`). Integration: provider-fake
completes a 3-task plan; induced failure blocks correctly.

### Task 4: Resume-on-boot  `[AEOS-P1.M6.T4]`
`src/scheduler.ts` (same loop — state is derived only from files) —
test: run task 1, hard-abort the loop, new scheduler instance over the
same dir completes the plan; completed tasks are never re-spawned;
transcripts never replayed (fresh sessions each).

## Exit gate
M6.T4 resume test green in CI (scheduler-boundary form; daemon-level
`kill -9` lands in M9's golden path).
