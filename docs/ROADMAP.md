# AEOS Roadmap — Phase/Milestone/Task Index

> **This file is the drift anchor for the whole build.** Task IDs are stable
> forever. Commits reference them (`feat(contracts): event envelope [AEOS-P1.M1.T2]`).
> Every milestone gets a detailed plan in `docs/superpowers/plans/` written so a
> cold-start agent (no conversation history) can execute it. A milestone plan may
> only be executed after its predecessor's **exit gate** passes.
>
> Spec: `docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`
> Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked

## Phase P1 — Spine (v0.1)

**Exit gate for the phase:** the golden-path demo passes — create agent → give
objective → agent works via hermetic Claude Code → `kill -9` the daemon →
restart → agent resumes at last checkpoint and completes → all state
inspectable as files.

### M1 — Monorepo scaffold + contracts package  `[ ]`
Plan: `docs/superpowers/plans/2026-07-13-aeos-p1-m1-contracts.md`
**Context brief:** Everything depends on `packages/contracts` (spec §5–§6). It
holds Zod schemas for the event envelope, domain objects, and the canonical
event taxonomy, exported also as JSON Schema. No package may import another's
internals; dependency-cruiser enforces it in CI.
- [x] **T1** pnpm monorepo scaffold (Node 22, ESM, strict TS, Vitest, base tsconfig). *Accept: `pnpm test` runs a passing trivial test in CI-identical command.*
- [x] **T2** Event envelope schema `{v,id,ts,source,agentId?,sessionId?,taskId?,type,payload}` with ULID ids. *Accept: round-trip parse/serialize tests pass; invalid envelopes rejected.*
- [ ] **T3** Domain schemas: Workspace, Agent(+harness feature toggles, credentialProfile ref), CredentialProfile(subscription|api-key|gateway), Session(+state machine), Objective, PlanTask, Checkpoint. *Accept: fixture YAML/JSON for each parses; illegal state transitions rejected by `assertSessionTransition`.*
- [ ] **T4** Canonical event taxonomy (`session.*`, `turn.*`, `item.*`, `cost.usage`, `approval.request`) as discriminated union. *Accept: golden fixture file of every event type parses exhaustively (compile-time exhaustiveness check).*
- [ ] **T5** JSON Schema export (`schemas/*.json` generated + committed) with a drift test. *Accept: `pnpm -F @aeos/contracts gen:schemas` output matches committed files in CI.*
- [ ] **T6** Boundary enforcement: dependency-cruiser config + GitHub Actions CI (install→build→test→depcruise). *Accept: CI green; a deliberate cross-internal import fails depcruise locally.*
**Exit gate:** all T-accepts green in CI on `main`.

### M2 — Kernel: state store, registry, event bus  `[ ]`
Plan: to be written at M1 exit (same file naming pattern).
**Context brief:** Spec §6–§7. `AEOS_HOME` file layout is truth; SQLite
(`index.db`, WAL) holds only derived indexes; `aeos reindex` rebuilds it from
files. Registry = CRUD over workspaces/agents backed by files. In-process event
bus typed by the M1 envelope; every published event appended to the owning
session's `transcript.ndjson`.
- [ ] **T1** `AEOS_HOME` layout module + atomic file writes (tmp+rename) + YAML codecs for `agent.yaml`/`session.yaml`. *Accept: crash-simulating test (kill between tmp write and rename) never leaves corrupt state.*
- [ ] **T2** SQLite derived index + `reindex()` full rebuild from files. *Accept: delete `index.db` → `reindex()` → identical query results test.*
- [ ] **T3** Registry (workspace/agent CRUD; agent dir initialized as git repo). *Accept: create/read/update round-trips; git history shows agent.yaml commits.*
- [ ] **T4** Event bus (typed pub/sub) + transcript appender. *Accept: events published during a fake session appear in order in `transcript.ndjson`.*
- [ ] **T5** Module lifecycle harness (`init→start/stop/health`) + composition root skeleton in `apps/aeosd`. *Accept: daemon boots, health endpoint-less self-check passes, clean shutdown test.*
**Exit gate:** kill-daemon-mid-write test leaves recoverable state; reindex test green.

### M3 — Session runner + supervisor  `[ ]`
**Context brief:** Spec §4, §10. One supervised OS process per live session,
framed length-prefixed protocol (4-byte BE) over Unix socket, versioned
handshake (min/max supported), heartbeats, per-session ring buffer, runner
writes transcript locally. Daemon re-adopts running runners by AEOS session ID
after restart. Never run node-pty under Bun (n/a — we're on Node, recorded for
contributors).
- [ ] **T1** Framed protocol codec + versioned handshake. *Accept: fuzz test (split/merged frames) decodes correctly; version mismatch → typed error.*
- [ ] **T2** Runner process: spawn arbitrary child, stream child stdout/stderr as events, heartbeat, hard timeout, STOP-file check. *Accept: runner survives daemon socket disconnect and keeps child alive.*
- [ ] **T3** Supervisor in daemon: spawn/track/re-adopt runners via `session.yaml` (pid + socket path), orphan detection on boot. *Accept: integration test — start session, SIGKILL daemon, restart daemon, session re-adopted with no event loss (ring buffer replay).*
- [ ] **T4** Session state machine enforcement in daemon (`created→…→orphaned`) emitting `session.*` events. *Accept: illegal transitions rejected; state persisted in `session.yaml` on every change.*
**Exit gate:** the M3.T3 re-adoption integration test is green in CI.

### M4 — Claude Code provider (hermetic + BYOK)  `[ ]`
**Context brief:** Spec §9. `HarnessAdapter` interface in `provider-core` +
conformance suite; Claude adapter builds hermetic profile
(`CLAUDE_CONFIG_DIR=<agent>/harness/claude`, `--bare`, `CLAUDE_CODE_DISABLE_*`,
re-enable via `--settings/--mcp-config/--plugin-dir` from `agent.yaml`
toggles), spawns `claude -p --output-format stream-json --verbose`, normalizes
NDJSON→canonical events, captures `session_id` + `total_cost_usd`, resume via
`--resume`. Credential profiles: subscription passthrough (opt-in), api-key
(`ANTHROPIC_API_KEY`), gateway (`ANTHROPIC_BASE_URL`+`ANTHROPIC_AUTH_TOKEN`,
optional `ANTHROPIC_MODEL`) — switch takes effect next spawn; emit
`cost.usage` with profile id. Tests run against recorded NDJSON fixtures
(provider-fake), plus one optional live smoke test behind an env flag.
- [ ] **T1** `HarnessAdapter` interface + capability matrix + conformance test suite in `provider-core`. *Accept: provider-fake passes conformance.*
- [ ] **T2** Hermetic profile builder (dir layout, settings.json generation from toggles, credential env injection from secret store). *Accept: generated profile contains zero references to `~/.claude`; toggles round-trip.*
- [ ] **T3** Spawn/stream/translate: NDJSON → canonical events, session_id + cost capture. *Accept: golden fixtures (recorded from real runs) translate byte-identically to expected canonical event files.*
- [ ] **T4** Resume + credential-profile switching (checkpoint → respawn with new profile → resume token honored). *Accept: fixture-driven test proves same objective continues across profile switch.*
- [ ] **T5** Usage-limit auto-failover hook (emit `approval.request` if policy=confirm, auto-switch if policy=allow). *Accept: simulated usage_limit fixture triggers documented behavior.*
**Exit gate:** conformance + golden translation + live smoke (manual, budget-capped) pass.

### M5 — Memory v0 (files as truth)  `[ ]`
**Context brief:** Spec §8. Directory layout + `MEMORY.md` index with per-dir
char budgets in frontmatter; over-budget writes return errors (no silent
truncation); frozen snapshot composer (index + relevance-selected files →
injection payload for the adapter); `memory.propose` applier (daemon-side,
policy-gated); `.archive/` moves, never deletes. FTS index in `index.db`,
rebuildable.
- [ ] **T1** Memory store: layout init, budgeted write/consolidate/archive ops. *Accept: over-budget write returns typed error; archive preserves file content.*
- [ ] **T2** Snapshot composer (deterministic ordering for cache stability). *Accept: same inputs → byte-identical snapshot; snapshot ≤ configured token budget.*
- [ ] **T3** `memory.propose` queue + applier + MEMORY.md index maintenance. *Accept: proposals applied atomically; index line always matches file set.*
- [ ] **T4** FTS derived index + `memory.search` API. *Accept: reindex-from-scratch equals incremental index results.*
**Exit gate:** memory survives reindex + snapshot determinism tests green.

### M6 — Objective/plan/checkpoint loop (scheduler v0)  `[ ]`
**Context brief:** Spec §7, §12. `objective.md` + `plan.md` (markdown checklist,
stable task IDs, status markers) + `checkpoints/<task>.yaml`
(`{taskId,status,commit?,providerResumeToken?,summary,costs}`). Sequential
scheduler: pick first incomplete task → spawn session via M4 → verify → write
checkpoint → advance. Resume-on-boot re-enters plan at first non-completed
task; transcripts never replayed. 3-strike backoff → task `blocked`, objective
paused, event emitted.
- [ ] **T1** Plan file parser/writer (checkbox+ID grammar, tolerant of human edits). *Accept: property-based round-trip test on generated plans; hand-mangled fixtures parse.*
- [ ] **T2** Checkpoint writer/reader + recovery resolver (plan+checkpoints → next task). *Accept: every crash-point fixture resolves to the correct next task.*
- [ ] **T3** Sequential scheduler loop wiring M2–M5 together, with 3-strike backoff. *Accept: integration test with provider-fake completes a 3-task plan; induced failure blocks correctly.*
- [ ] **T4** Resume-on-boot: orphan scan + plan re-entry. *Accept: SIGKILL daemon mid-task → restart → plan completes (provider-fake).*
**Exit gate:** M6.T4 green — this is the heart of the phase.

### M7 — API + SSE + SDK  `[ ]`
**Context brief:** Spec §14. Fastify + OpenAPI 3.1 → generated TS SDK.
Resources: workspaces, agents, objectives, plans, sessions, memory, events.
Envelope `{success,data,error,meta}`. One SSE stream `/v1/events` with filter
params. Loopback-only default; token auth when bound wider. Credential-profile
switch endpoint (`POST /v1/agents/:id/credential-profile`) — the BYOK
"on-the-go" toggle.
- [ ] **T1** Server skeleton + envelope + OpenAPI generation + error mapping. *Accept: spec file generated in CI; contract tests for envelope.*
- [ ] **T2** Resource routes over registry/scheduler/memory. *Accept: CRUD + objective-start integration tests green.*
- [ ] **T3** SSE event stream with filters + backfill-from-transcript. *Accept: reconnect test receives missed events exactly once.*
- [ ] **T4** Generated SDK + `apps/cli` thin client (create agent, start objective, tail events, switch credential profile). *Accept: CLI golden-path script passes against live local daemon.*
**Exit gate:** CLI golden path green.

### M8 — ADE minimal web UI  `[ ]`
**Context brief:** Spec §14 + `mockup.png`. React+Vite served by daemon.
Sidebar: workspaces→agent avatars. Main: agent conversation, session tabs
(xterm.js read-only event stream v0), "Access Agent Files" browser
(memory/objectives/worktree), credential-profile switch control, cost meter.
No Tauri wrapper in P1 (P2).
- [ ] **T1** UI shell + routing + SDK wiring + sidebar per mockup. *Accept: Playwright: create workspace/agent via UI.*
- [ ] **T2** Conversation + live session tab streaming SSE into xterm.js. *Accept: Playwright sees streamed provider-fake output.*
- [ ] **T3** Agent files browser + plan/checkpoint viewer. *Accept: Playwright opens memory file and plan status.*
- [ ] **T4** BYOK switch + cost meter widgets. *Accept: switching profile mid-objective visible in UI and in `costs.ndjson`.*
**Exit gate:** Playwright suite green.

### M9 — Golden-path E2E + hardening  `[ ]`
**Context brief:** Spec §18. Full demo as an automated test (provider-fake in
CI; real Claude Code nightly behind env flag, budget-capped): create agent →
objective → work → `kill -9` daemon → restart → resume → complete. Plus:
`aeos stop --all` + STOP file kill switch; docs pass (README, quickstart,
CONTRIBUTING, ADRs for D1–D7).
- [ ] **T1** E2E golden-path test (CI, provider-fake). *Accept: green 10× consecutively (flake gate).*
- [ ] **T2** Nightly live E2E (real harness, capped). *Accept: one green nightly run recorded.*
- [ ] **T3** Kill switch + STOP file honored by daemon and runners. *Accept: STOP file halts all non-readonly ops within one heartbeat.*
- [ ] **T4** Docs + ADRs + v0.1 tag. *Accept: quickstart works on a clean machine following only the README.*
**Exit gate = P1 exit gate** (top of this section).

## Phase P2 — Safety + polish  `[ ]`
Policy engine full tiers + approvals inbox; budgets (daemon-enforced caps);
audit log; secrets store; memory curator; PTY attach (human takeover); Codex +
OpenCode adapters; managed harness binaries; Tauri desktop wrapper.
*Milestones defined at P1 exit.*

## Phase P3 — Autonomy  `[ ]`
Planner task classes; cost-aware model router (OpenRouter pricing index);
verification task type; retrospective/self-learning loop; scheduler wakeups;
delegation to specialist agents.

## Phase P4 — Scale + community  `[ ]`
Docker sandbox tier; public plugin API + docs; deploy targets
(compose/systemd/Helm); TCP runner transport; Kubernetes; multi-user auth.
