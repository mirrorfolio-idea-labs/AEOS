# AEOS P2.M4 — Memory Curator Implementation Plan

> **For agentic workers:** task-by-task, in order. Full green bar
> (`pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`)
> before every commit; the completing commit flips that ROADMAP checkbox.

**Goal:** an idle-triggered background job that summarizes, deduplicates,
and ages agent memory — archiving, never deleting — applying every change
only through the existing `memory.propose` pipeline, with a dry-run mode and
its own audit trail (spec §8 rule 4).

**Architecture:** the curator engine lives in `packages/memory/src/`
(spec §5 assigns the curator to the memory package). It is *pure logic over
the memory tree*: scanning produces a deterministic proposal list;
applying reuses `enqueueProposal` + `applyProposals` unchanged — so atomicity,
budget checks, index sync, and the policy-gated applier are inherited, not
rebuilt. The daemon (`apps/aeosd`) owns only the trigger wiring: a bus
subscription that tracks last activity per agent plus a tick timer, both
opt-in via env. The curator becomes the first live emitter of
`memory.written` through `applyProposals`' staged `onEvent` hook (S07 note),
which lands those events in the audit trail automatically.

## Design decisions made under the repo's own constraints

1. **v0.2 curator operations are mechanical/deterministic; no model call.**
   Basis: the milestone exit gate itself — "curator run over fixture memory
   is **deterministic**, audited, and lossless" — cannot hold with a live
   model in the loop, and spec §18 keeps CI provider-fake. "Summarize" is
   therefore extractive v0 (headings + leading prose, char-capped), behind a
   `summarize?` option so the P3.M2 router can inject a cheap-model
   summarizer later without touching call sites. The spec's "running as a
   cheap-model session" is the production end-state; this plan builds its
   deterministic skeleton. Logged in S08.
2. **Trigger = activity-gap, not cron.** Durable cron/idle jobs are P3.M5;
   until then the honest idle signal is "no bus events for this agent for
   `idleMs`". Eligibility is a pure exported function so it is unit-testable
   without timers; the daemon supplies only `Date.now()`, the tick, and the
   subscription.
3. **Opt-in via `AEOS_CURATOR=1`.** Mirrors the `AEOS_SECRETS_STORE=1`
   precedent (S07): new background behavior never surprises existing
   deployments or golden-path fixtures; Kabeer flips it on his daemon.
4. **Own audit trail = `<home>/audit/curator-<UTC-date>.ndjson`.** Spec §8.4
   says "its own audit trail" — a separate append-only stream next to the
   main audit files (kernel's `auditDir()` helper), one NDJSON line per run
   including dry-runs, written with `fs.appendFileSync` only (same discipline
   as `attachAuditWriter`).

## Global constraints

- No contracts changes (no new event types — `memory.written` already exists
  in the taxonomy and audit set). If a task turns out to need one, STOP and
  renegotiate the plan.
- Conventional commits with `[AEOS-P2.M4.T<n>]`; ROADMAP flip in-completion-
  commit; files ≤800 lines; depcruise clean (memory may import `@aeos/kernel`
  and `@aeos/contracts` only; aeosd imports published entry points).
- The curator NEVER calls `rm`/`unlink`/`truncate` on anything under an
  agent's `memory/` tree. The only deletion in the propose pipeline is the
  applied-proposal queue file (`.proposals/`), which is queue hygiene, not
  memory content (pre-existing, tested).

---

### Task 1: Curator scaffold + idle trigger + dry-run mode  `[AEOS-P2.M4.T1]`

**Files:**
- Create: `packages/memory/src/curator.ts`:
  - `interface CuratorScanInput { root: string; now: Date; staleDays?: number }`
    (default `staleDays = 30`).
  - `scanMemory(root, input): Promise<CuratorProposal[]>` — v0 scans and
    reports **stale** candidates only (T2 adds dedup + over-budget):
    a file is stale when `mtime < now - staleDays`; candidates sorted by
    mtime asc, then path asc (total order ⇒ deterministic). `identity/**`
    and `MEMORY.md` are never candidates (spec §8: identity is stable).
    `.archive/` and `.proposals/` are never scanned.
  - `runCurator(root, opts: { dryRun: boolean; now: Date; auditHome: string;
    agentRef: string; onApplied?: Parameters<typeof applyProposals>[1] })` —
    scans, writes one append-only line to
    `<auditHome>/audit/curator-<utcdate>.ndjson`
    (`{ ts, agentRef, dryRun, proposals }`), and in dry-run does nothing
    else. Non-dry-run behavior arrives in T2 (this task throws
    `Error('apply mode lands in P2.M4.T2')` if `dryRun: false` — explicit,
    not silent).
  - `isCuratorDue({ lastActivityMs, lastRunMs, nowMs, idleMs, minIntervalMs })`
    — pure eligibility function: due iff `now - last >= idleMs` AND
    `last === undefined || now - lastRun >= minIntervalMs`.
  - Export all from `packages/memory/src/index.ts`.
- Create: `packages/memory/test/curator.test.ts`:
  - fixture tree via `initMemoryLayout` + seeded files with explicit
    `utimes`; dry-run returns the expected proposal list (right files, right
    order, right reasons) AND leaves the tree byte-identical (walk +
    hash every file before/after, MEMORY.md included);
  - fresh files produce zero proposals; `identity/` staleness ignored;
  - `isCuratorDue` truth table (idle edge, interval edge, first run);
  - dry-run appends exactly one curator-log line marked `dryRun: true`,
    and the log grows append-only across two runs.
- Modify: `apps/aeosd/src/daemon.ts` + `main.ts` — opt-in module: when
  `AEOS_CURATOR=1`, subscribe to the redacting bus recording
  `lastActivity[agentId] = ts` for every event carrying `agentId`, tick
  every 60s, enumerate `listWorkspaces`/`listAgents`, and for each due agent
  run `runCurator(..., { dryRun: true, ... })`. Knobs:
  `AEOS_CURATOR_IDLE_MS` (default 900 000), `AEOS_CURATOR_MIN_INTERVAL_MS`
  (default 21 600 000). Module stops its timer on daemon stop; errors in one
  agent's run are logged to stderr and never kill the tick. Daemon boots
  identically when the flag is absent (golden-path untouched).
- Tests: `apps/aeosd/test/curator-trigger.e2e.test.ts` — boot daemon with
  `AEOS_CURATOR=1`, tiny idle/interval knobs, publish a fake agent event,
  advance past idle (fake timers or short real sleep — match house style
  used by scheduler tests), assert one curator log line for that agent with
  `dryRun: true` and no memory mutations.

**Steps:** RED curator tests → implement scan/dry-run/eligibility → RED
trigger e2e → wire daemon → full green bar → commit
`feat(memory): curator scaffold, idle trigger, dry-run [AEOS-P2.M4.T1]`.

---

### Task 2: Aging / dedup / summarize operations via `memory.propose`  `[AEOS-P2.M4.T2]`

**Files:**
- Modify: `packages/memory/src/curator.ts`:
  - extend `scanMemory` with dedup + over-budget detection:
    **dedup** — identical sha256 within one dir → keep lexicographically
    first path, propose archiving the rest (reason `duplicate`);
    **over-budget** — usage > `index.budgets[dir]` → propose
    consolidating the two oldest files into one summarized file
    (reason `over-budget`; title from the older file, content =
    the built-in extractive summary — leading half of each source,
    newline-joined — or the injected `summarize(sources)` seam);
  - implement apply mode: map proposals → `MemoryProposal`s
    (archive → `{op:'archive'}`; over-budget → `{op:'consolidate'}`),
    `enqueueProposal` each, then `applyProposals(root, onApplied)` — the
    existing pipeline performs budget-checked atomic writes, `.archive/`
    moves, index sync. A proposal whose application fails stays queued and
    is reported (`ApplyResult.status='failed'`), never retried in-run;
  - `summarize?: (input: { path: string; content: string }) => Promise<string>`
    option plumbed through `runCurator` (default: built-in extractive).
- Modify: `packages/memory/src/index.ts` exports as needed.
- Tests: extend `packages/memory/test/curator.test.ts`:
  - fixture tree with stale + duplicate + over-budget dirs → apply run
    reorganizes exactly as expected (ROADMAP accept quotes this);
  - budgets respected: consolidated dir ends ≤ budget; an `OverBudgetError`
    from the applier surfaces as a `failed` result with the queue file
    retained;
  - dedup keeps the lexicographically-first copy's path intact;
  - apply mode emits `onApplied` events (`memory.written` payloads for the
    audit trail);
  - determinism: two scans of the same tree yield identical proposal lists
    (normalize nothing — no timestamps inside proposals).

**Steps:** RED extended tests → implement dedup/budget ops + apply mode →
full green bar → commit
`feat(memory): curator aging/dedup/summarize via memory.propose [AEOS-P2.M4.T2]`.

---

### Task 3: Curator audit trail + never-delete guarantee  `[AEOS-P2.M4.T3]`

**Files:**
- Modify: `packages/memory/src/curator.ts` — enrich the curator log line
  with applied results (`{ ..., results }`) and proposal reasons; assert
  (runtime guard) that a run refuses an `agentRef` whose root escapes the
  agent's memory dir (path-traversal guard on `root`).
- Tests: `packages/memory/test/curator-guarantees.test.ts`:
  - **losslessness:** build a fixture tree, snapshot every file's bytes,
    run apply-mode curator to completion, then assert the multiset of
    original file contents is fully contained in the union of the current
    tree + `.archive/` — every byte recoverable (ROADMAP T3 accept);
  - **append-only own trail:** interleaved dry-run/apply runs across two
    UTC dates (injected `now`) produce date-split files, each strictly
    append-only, every run represented exactly once;
  - **no deletion path:** after any run there is no moment at which a
    pre-existing content string is absent from disk — verified by the
    recovery test above plus a schema-level assertion that the curator can
    emit only `archive`/`consolidate` proposals (type-level exhaustiveness
    test on the proposal union);
  - traversal guard rejects `../`-style roots with a typed error.
- Exit-gate e2e extension: `apps/aeosd/test/curator-trigger.e2e.test.ts`
  gains the full-loop case — daemon with `AEOS_CURATOR=1`, seeded stale
  fixture memory, idle window elapses, dry-run fires (log line), then an
  induced apply-mode run: tree reorganized, `memory.written` visible in
  `audit/audit-<date>.ndjson`, curator trail present, tree lossless.

**Steps:** RED guarantees tests → harden + guard → RED e2e loop case →
full green bar → commit
`feat(memory): curator audit trail + never-delete guarantee [AEOS-P2.M4.T3]`.

---

## Exit gate (P2.M4)

A scripted run over the fixture memory tree is **deterministic** (identical
proposal lists across runs), **audited** (own trail + `memory.written` rows
in the main audit), and **lossless** (byte-recovery property green). All
three checkboxes `[x]`, R5 rescan clean, S08 closed with retro, BOARD synced.
