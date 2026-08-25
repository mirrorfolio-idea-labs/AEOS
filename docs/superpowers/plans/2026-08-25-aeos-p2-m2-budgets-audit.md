# AEOS P2.M2 — Budgets + Audit Log Implementation Plan

> **For agentic workers:** task-by-task, in order. Full green bar
> (`pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`)
> before every commit; the completing commit flips that ROADMAP checkbox.

**Goal:** daemon-enforced spend caps (USD + tokens) per objective with a
hard-stop → checkpoint → notify → `resume-with-increase` path, and an
append-only audit trail under `<AEOS_HOME>/audit/` covering every action
class (spec §11).

**Architecture:** the scheduler already sums per-task cost — it becomes the
authoritative enforcement point (only it can write checkpoints). Accounting
core lives in `@aeos/policy` (`budget-meter.ts`) so the future agent-level
meter reuses it. Budget config is a FILE: `<objectiveDir>/objective.yaml`
(`ObjectiveSchema`, already in contracts). Audit is a bus subscriber wired in
the API module (same seam as transcripts/approvals), appending to
`audit/audit-YYYY-MM-DD.ndjson` (spec §7 layout name wins over §11's
`.ndjsonl` — drift noted in BOARD D9).

**No new third-party dependencies.**

## Global constraints

- Contracts changes ⇒ `pnpm -F @aeos/contracts gen:schemas` + regenerated
  openapi/types committed in the same commit.
- Conventional commits with `[AEOS-P2.M2.T<n>]`; ROADMAP flip in-completion-
  commit; files ≤800 lines.

---

### Task 1: Budget config + meter, hard-stop writes checkpoint  `[AEOS-P2.M2.T1]`

**Files:**
- Create: `packages/policy/src/budget-meter.ts` — `BudgetMeter` class:
  `record(spend: {usd, tokens}) → {totalUsd, totalTokens, exceeded: 'usd'|'tokens'|null}`.
  Pure accounting, no I/O.
- Modify: `packages/scheduler/src/scheduler.ts` — `RunObjectiveOptions.budget?:
  { usdCap?: number; tokenCap?: number }`; inside the event loop, after each
  `cost.usage`, if the meter reports exceeded: write checkpoint
  `{taskId, status:'pending', attempts (unchanged), summary:'hard-stopped:
  budget cap (<cap>) reached at <spent>'}` and return
  `{status:'paused', taskId, reason:'budget cap reached'}` WITHOUT consuming a
  strike. Also read `<objectiveDir>/objective.yaml` when present for default
  budget config (explicit opts win).
- Create: `packages/policy/src/objective-file.ts` +
  scheduler helper to read it via `ObjectiveSchema`.
- Modify: `packages/api/src/routes/objectives.ts` — `CreateObjective` gains
  optional `budgetUsd`/`budgetTokens`; when present, write
  `<objectiveDir>/objective.yaml`; `startObjectiveRun` passes the loaded
  budget into `runObjective`.
- Contracts: add `budget.exceeded` event
  `{scope:'objective', id:string, kind:'usd'|'tokens', cap:number, spent:number}`
  (+golden line, gen:schemas).
- Tests: `packages/policy/test/budget-meter.test.ts`,
  `packages/scheduler/test/budget-stop.test.ts` (fixture objective whose fake
  script spends past the cap → paused outcome + checkpoint file on disk with
  status pending + `budget.exceeded` emitted).

**Steps:** RED meter tests → implement → RED scheduler test (tmp objectiveDir,
fake adapter with $0.02 usage vs $0.01 cap) → implement → wire API → green bar
→ commit `feat(policy): budget meter + scheduler hard-stop [AEOS-P2.M2.T1]`.

---

### Task 2: Notify + resume-with-increase  `[AEOS-P2.M2.T2]`

**Files:**
- Modify: `apps/aeosd/src/api-module.ts` — nothing new if T1 wiring suffices;
  ensure restarting a budget-paused objective re-reads `objective.yaml` fresh
  (no caching of caps across runs).
- Test: `apps/aeosd/test/budget-resume.e2e.test.ts` — real daemon, fake
  provider: objective with `$0.01` cap parks hard-stopped (task still
  `pending`, no attempt burned); rewrite `objective.yaml` with `$1.00` cap;
  POST start again → completes. Negative control: restart WITHOUT raising →
  pauses again immediately (and attempts stay unchanged).

**Steps:** RED e2e → fix whatever T1 missed (fresh-read semantics) → green bar
→ commit `feat(aeosd): resume-with-increase after budget hard-stop [AEOS-P2.M2.T2]`.

---

### Task 3: Append-only audit appender  `[AEOS-P2.M2.T3]`

**Files:**
- Create: `packages/kernel/src/audit/audit.ts` (kernel owns AEOS_HOME layout)
  — `attachAuditWriter(bus, home)` bus subscriber appending one NDJSON line per
  audited event to `audit/audit-YYYY-MM-DD.ndjson` (date = event ts, UTC):
  audited classes = `item.tool_call`, `item.tool_result`, `approval.request`,
  `approval.resolved`, `policy.blocked`, `budget.exceeded`, `cost.usage`,
  `memory.written` (NEW contracts event `{path, bytes}` emitted by the memory
  propose applier), plus `session.created/completed/failed`. Line shape:
  envelope + `auditVersion:1`. Writes ONLY via `fs.appendFile` — never
  truncate/rewrite.
- Modify: kernel index export; `apps/aeosd/src/daemon.ts` attach alongside
  transcript writer; memory package emits `memory.written` through its applier
  callback (thread an optional `onEvent` through propose apply path).
- Contracts: `memory.written` event + golden line + regen.
- Tests: `packages/kernel/test/audit.test.ts` — golden audit trail for a
  scripted session fixture (exact expected lines); append-only property:
  pre-existing audit content is byte-preserved after further events; date
  rollover creates a second file rather than touching yesterday's.

**Steps:** RED kernel tests → implement writer → RED memory-event test → wire
emitter → daemon attach → green bar + Playwright smoke unchanged → commit
`feat(kernel): append-only audit appender [AEOS-P2.M2.T3]`.

---

## Exit gate (P2.M2)

Flagship runaway-loop proof (in `budget-resume.e2e.test.ts`): a scripted fake
that would emit unbounded `cost.usage` events cannot push cumulative spend
past its cap across REPEATED restarts without a cap raise — total recorded
spend never exceeds cap by more than the single in-flight event granularity.
All three checkboxes `[x]`, R5 drift scan clean, S06 closed, BOARD synced —
then and only then JIT-author P2.M3's plan.
