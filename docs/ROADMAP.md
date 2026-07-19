# AEOS Roadmap — Phase/Milestone/Task Index

> **This file is the drift anchor for the whole build.** Task IDs are stable
> forever. Commits reference them (`feat(contracts): event envelope [AEOS-P1.M1.T2]`).
> Every milestone gets a detailed plan in `docs/superpowers/plans/` written so a
> cold-start agent (no conversation history) can execute it. A milestone plan may
> only be executed after its predecessor's **exit gate** passes.
>
> Spec: `docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`
> Board, sprints, task cards: `docs/pm/` (operating manual: `docs/pm/README.md`)
> Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked

## Phase P1 — Spine (v0.1)

**Exit gate for the phase:** the golden-path demo passes — create agent → give
objective → agent works via hermetic Claude Code → `kill -9` the daemon →
restart → agent resumes at last checkpoint and completes → all state
inspectable as files.

### M1 — Monorepo scaffold + contracts package  `[x]`
Plan: `docs/superpowers/plans/2026-07-13-aeos-p1-m1-contracts.md`
**Context brief:** Everything depends on `packages/contracts` (spec §5–§6). It
holds Zod schemas for the event envelope, domain objects, and the canonical
event taxonomy, exported also as JSON Schema. No package may import another's
internals; dependency-cruiser enforces it in CI.
- [x] **T1** pnpm monorepo scaffold (Node 22, ESM, strict TS, Vitest, base tsconfig). *Accept: `pnpm test` runs a passing trivial test in CI-identical command.*
- [x] **T2** Event envelope schema `{v,id,ts,source,agentId?,sessionId?,taskId?,type,payload}` with ULID ids. *Accept: round-trip parse/serialize tests pass; invalid envelopes rejected.*
- [x] **T3** Domain schemas: Workspace, Agent(+harness feature toggles, credentialProfile ref), CredentialProfile(subscription|api-key|gateway), Session(+state machine), Objective, PlanTask, Checkpoint. *Accept: fixture YAML/JSON for each parses; illegal state transitions rejected by `assertSessionTransition`.*
- [x] **T4** Canonical event taxonomy (`session.*`, `turn.*`, `item.*`, `cost.usage`, `approval.request`) as discriminated union. *Accept: golden fixture file of every event type parses exhaustively (runtime golden-fixture test asserting fixture coverage equals the declared type set).*
- [x] **T5** JSON Schema export (`schemas/*.json` generated + committed) with a drift test. *Accept: `pnpm -F @aeos/contracts gen:schemas` output matches committed files in CI.*
- [x] **T6** Boundary enforcement: dependency-cruiser config + GitHub Actions CI (install→build→test→depcruise). *Accept: CI green; a deliberate cross-internal import fails depcruise locally.*
**Exit gate:** all T-accepts green in CI on `main`.

### M2 — Kernel: state store, registry, event bus  `[x]`
Plan: `docs/superpowers/plans/2026-07-13-aeos-p1-m2-kernel.md`
**Context brief:** Spec §6–§7. `AEOS_HOME` file layout is truth; SQLite
(`index.db`, WAL) holds only derived indexes; `aeos reindex` rebuilds it from
files. Registry = CRUD over workspaces/agents backed by files. In-process event
bus typed by the M1 envelope; every published event appended to the owning
session's `transcript.ndjson`.
- [x] **T1** `AEOS_HOME` layout module + atomic file writes (tmp+rename) + YAML codecs for `agent.yaml`/`session.yaml`. *Accept: crash-simulating test (kill between tmp write and rename) never leaves corrupt state.*
- [x] **T2** SQLite derived index + `reindex()` full rebuild from files. *Accept: delete `index.db` → `reindex()` → identical query results test.*
- [x] **T3** Registry (workspace/agent CRUD; agent dir initialized as git repo). *Accept: create/read/update round-trips; git history shows agent.yaml commits.*
- [x] **T4** Event bus (typed pub/sub) + transcript appender. *Accept: events published during a fake session appear in order in `transcript.ndjson`.*
- [x] **T5** Module lifecycle harness (`init→start/stop/health`) + composition root skeleton in `apps/aeosd`. *Accept: daemon boots, health endpoint-less self-check passes, clean shutdown test.*
**Exit gate:** kill-daemon-mid-write test leaves recoverable state; reindex test green.

### M3 — Session runner + supervisor  `[x]`
Plan: `docs/superpowers/plans/2026-07-14-aeos-p1-m3-runner.md`
**Context brief:** Spec §4, §10. One supervised OS process per live session,
framed length-prefixed protocol (4-byte BE) over Unix socket, versioned
handshake (min/max supported), heartbeats, per-session ring buffer, runner
writes transcript locally. Daemon re-adopts running runners by AEOS session ID
after restart. Never run node-pty under Bun (n/a — we're on Node, recorded for
contributors).
- [x] **T1** Framed protocol codec + versioned handshake. *Accept: fuzz test (split/merged frames) decodes correctly; version mismatch → typed error.*
- [x] **T2** Runner process: spawn arbitrary child, stream child stdout/stderr as events, heartbeat, hard timeout, STOP-file check. *Accept: runner survives daemon socket disconnect and keeps child alive.*
- [x] **T3** Supervisor in daemon: spawn/track/re-adopt runners via `session.yaml` (pid + socket path), orphan detection on boot. *Accept: integration test — start session, SIGKILL daemon, restart daemon, session re-adopted with no event loss (ring buffer replay).*
- [x] **T4** Session state machine enforcement in daemon (`created→…→orphaned`) emitting `session.*` events. *Accept: illegal transitions rejected; state persisted in `session.yaml` on every change.*
**Exit gate:** the M3.T3 re-adoption integration test is green in CI.

### M4 — Claude Code provider (hermetic + BYOK)  `[~]`
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
- [x] **T1** `HarnessAdapter` interface + capability matrix + conformance test suite in `provider-core`. *Accept: provider-fake passes conformance.*
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

## Phase P2 — Safety + polish (v0.2)  `[ ]`

**Exit gate for the phase:** a new agent runs under least-privilege policy with
daemon-enforced budget caps, every action audited, secrets never leaking into
transcripts, on any of three harnesses (Claude/Codex/OpenCode), with human PTY
takeover available — demonstrated by the P2 integration suite; `v0.2` tagged.
Detailed plans per milestone are written just-in-time at each predecessor's
exit (same rule as P1).

### M1 — Policy engine + approvals inbox  `[ ]`
**Context brief:** Spec §11. Permission tiers (`read_files … network_access`)
mapped to `allow|confirm|deny`; YAML policies layered workspace → agent →
objective (most-specific wins); compiled to harness-native flags AND enforced
daemon-side (defense in depth). Approvals: `approval.request` event →
`waiting_approval` state → UI/CLI answer; deny-by-default on timeout.
- [ ] **T1** Policy schema + layered loader/merger. *Accept: fixture matrix of layered policies compiles to expected effective policy.*
- [ ] **T2** Policy compiler → harness-native flags (Claude `--allowedTools`/permission modes; Codex `approval_policy`/sandbox). *Accept: golden mapping tests per tier per harness.*
- [ ] **T3** Daemon-side enforcement at the runner/API boundary. *Accept: provider-fake attempting a denied action is blocked even with permissive harness flags.*
- [ ] **T4** Approval flow end-to-end incl. configurable timeout → deny. *Accept: integration test covers approve, deny, and expiry paths.*
- [ ] **T5** Approvals inbox in ADE + notification hook. *Accept: Playwright approve/deny round-trip updates session state.*
**Exit gate:** new-agent default posture (read-only + worktree-write + confirm-everything-else) verified end-to-end.

### M2 — Budgets + audit log  `[ ]`
**Context brief:** Spec §11. Per-agent and per-objective caps (USD + tokens)
metered from `cost.usage` events; hard-stop at cap with checkpoint + notify +
`resume-with-increase`. Append-only `audit/*.ndjsonl` for every action class.
- [ ] **T1** Budget config + meter wired to the event bus. *Accept: simulated spend crossing cap hard-stops with a checkpoint written.*
- [ ] **T2** Notify + `resume-with-increase` path. *Accept: fixture objective resumes and completes after cap raise.*
- [ ] **T3** Audit appender covering tool calls, approvals, policy decisions, memory writes, spend. *Accept: golden audit trail for a scripted session; append-only property tested.*
**Exit gate:** runaway-loop simulation cannot outspend its cap (flagship test).

### M3 — Secrets store  `[ ]`
**Context brief:** Spec §11. OS keychain where available, age-encrypted file
fallback; injection into runner env per policy; never written to worktrees,
profiles, or transcripts — redaction filter on the event pipeline.
- [ ] **T1** Secret store (keychain + age fallback) with CRUD API. *Accept: round-trip on both backends; store file unreadable without key.*
- [ ] **T2** Policy-gated env injection into runners. *Accept: secret available in-session only when policy allows; absent otherwise.*
- [ ] **T3** Redaction filter on the event pipeline. *Accept: canary secret planted in a session never appears in transcripts, events, or audit logs.*
**Exit gate:** canary-leak test green across all sinks.

### M4 — Memory curator  `[ ]`
**Context brief:** Spec §8. Idle-triggered background job running as a
cheap-model session with dry-run mode and its own audit trail; summarizes,
dedupes, ages (active → stale → archived); archives, never deletes; applies
changes only via `memory.propose`.
- [ ] **T1** Curator job scaffold + idle trigger + dry-run mode. *Accept: dry-run emits a proposal report and changes nothing.*
- [ ] **T2** Aging/dedup/summarize operations via `memory.propose`. *Accept: fixture memory tree reorganized as expected; budgets respected.*
- [ ] **T3** Curator audit trail + never-delete guarantee. *Accept: every byte of archived content recoverable from `.archive/`; test proves no deletion path exists.*
**Exit gate:** curator run over fixture memory is deterministic, audited, and lossless.

### M5 — PTY attach + co-edit guard  `[ ]`
**Context brief:** Spec §9–§10 (PTY as human-takeover escape hatch; WebSocket
only for PTY) + spec §20 OQ1 (human edits agent worktree — resolve by ADR here).
- [ ] **T1** Runner PTY allocation bridged alongside event parsing. *Accept: takeover session still produces a coherent canonical event stream.*
- [ ] **T2** WebSocket attach endpoint + xterm.js interactive tab (attach/release). *Accept: Playwright types a command via UI terminal; release returns to headless.*
- [ ] **T3** Co-edit detection ADR + guard (dirty-worktree check → pause + notify). *Accept: human edit in agent worktree pauses the task with an `approval.request`.*
**Exit gate:** mid-session human takeover and clean handback demonstrated.

### M6 — Codex + OpenCode adapters  `[ ]`
**Context brief:** Spec §9. Hermetic profiles (Codex: `CODEX_HOME` + generated
`config.toml`; OpenCode: per-agent `XDG_*_HOME` + `OPENCODE_DISABLE_PROJECT_CONFIG=1`);
translate `thread/turn/item` and SSE into the canonical taxonomy; resume
support; both pass the M4(P1) conformance suite.
- [ ] **T1** Codex adapter (profile, spawn, translate, resume). *Accept: recorded-fixture translation byte-identical; conformance green.*
- [ ] **T2** OpenCode adapter (profile, spawn/serve, translate, resume). *Accept: same bar as T1.*
- [ ] **T3** Cross-harness capability matrix + docs. *Accept: matrix asserted by conformance tests, not hand-maintained.*
**Exit gate:** the same fixture objective completes on all three adapters.

### M7 — Managed harness binaries  `[ ]`
**Context brief:** Spec §9 (Conductor pattern). Pin + manage harness versions
per agent with checksum verification; BYO-binary fallback; capability gating
by version (spec §17.2 mitigation).
- [ ] **T1** Binary manager (fetch, pin, verify, per-agent version selection). *Accept: tampered binary rejected; pinned version used over PATH.*
- [ ] **T2** BYO fallback + version-gated capabilities. *Accept: feature requiring version X is refused under pinned version < X with a typed error.*
**Exit gate:** conformance suite runs in CI against pinned versions.

### M8 — Tauri desktop wrapper  `[ ]`
**Context brief:** Spec §14 (D4). Thin Tauri shell around the served web UI;
deep links + native notifications; no UI logic forked into the shell.
- [ ] **T1** Tauri shell loading the daemon-served UI (daemon lifecycle handled). *Accept: app cold-starts daemon if absent; quits cleanly.*
- [ ] **T2** Native notifications (approvals, budget stops) + deep links. *Accept: approval notification opens the inbox view.*
- [ ] **T3** macOS + Linux build artifacts in CI. *Accept: installable artifacts produced by CI.*
**Exit gate = P2 exit gate** (top of this section).

## Phase P3 — Autonomy (v0.3)  `[ ]`

**Exit gate for the phase:** unattended demo — objective in, plan generated
with task classes, tasks routed to different models by class, verification
gates progression, retrospective updates memory that provably feeds the next
session's snapshot; `v0.3` tagged.

### M1 — Planner task classes  `[ ]`
**Context brief:** Spec §12–§13. Planning is a frontier-routed model call
producing a plan file (M6(P1) grammar) whose tasks carry a class
(`plan, architect, implement, refactor, review, security_review, summarize, docs, rename`).
- [ ] **T1** `taskClass` in PlanTask contract + schema regen. *Accept: schema drift test green; old plans without class still parse (default `implement`).*
- [ ] **T2** Planner flow (objective → generated plan) with policy-gated approval. *Accept: provider-fake objective yields a valid classed plan; approval gate honored.*
**Exit gate:** generated plan executes end-to-end on provider-fake.

### M2 — Cost-aware model router  `[ ]`
**Context brief:** Spec §13. Pricing/capability index (OpenRouter `/models` +
static tables for subscription harnesses, daily refresh, offline cache);
routing policy class → (provider, model, thinking budget) with per-workspace
overrides; decisions + realized costs logged per task.
- [ ] **T1** Pricing index with refresh + offline fallback. *Accept: index survives network-down (stale-but-served); refresh test with recorded API fixture.*
- [ ] **T2** Routing policy engine + overrides. *Accept: fixture matrix (class × policy) routes as documented.*
- [ ] **T3** Decision + realized-cost logging. *Accept: every routed task has a queryable route/cost record; audit shows decision inputs.*
**Exit gate:** integration test proves plan tasks of different classes hit different (fake) providers per policy.

### M3 — Verification task type  `[ ]`
**Context brief:** Spec §12. Verification (tests/lint/build) is a first-class
task type whose result gates progression and feeds checkpoint status.
- [ ] **T1** Verification runner (command classes, result parsing, typed outcomes). *Accept: pass/fail/flaky outcomes distinguished in checkpoints.*
- [ ] **T2** Planner emits verification tasks after each implement task. *Accept: generated plans interleave verify tasks; failed verify triggers 3-strike backoff.*
**Exit gate:** induced verification failure blocks the plan exactly as specced.

### M4 — Retrospective / self-learning loop  `[ ]`
**Context brief:** Spec §8.5. Post-objective retrospective diffs plan vs
actuals (corrections, failures, re-dos) and writes `lessons/` +
`preferences/` proposals via `memory.propose`; preferences feed every future
frozen snapshot.
- [ ] **T1** Retrospective job generating proposals from checkpoint/transcript diffs. *Accept: fixture objective produces the expected lesson files.*
- [ ] **T2** Snapshot pipeline includes accepted preferences. *Accept: next-session snapshot provably contains the new preference (byte-level test).*
**Exit gate:** two-objective fixture shows objective 2 benefiting from objective 1's lessons.

### M5 — Scheduler wakeups + delegation  `[ ]`
**Context brief:** Spec §12. Cron-like + idle-triggered durable jobs (curator
already consumes this); delegation: a task may name another agent or a spawned
specialist sub-session, coordinating via plan file + git only.
- [ ] **T1** Wakeup scheduler (cron + idle) with durable job persistence across daemon restarts. *Accept: job scheduled, daemon killed, job fires after restart.*
- [ ] **T2** Delegation: assign task → spawn/target other agent → integrate via plan+git. *Accept: multi-agent fixture objective completes with one delegated task.*
**Exit gate = P3 exit gate** (top of this section).

## Phase P4 — Scale + community (v0.4)  `[ ]`

**Exit gate for the phase:** every deploy target has a tested quickstart; a
third-party plugin can be built and installed without touching core; `v0.4`
tagged. (Multi-user RBAC is **post-v1** per spec §14 — see backlog.)

### M1 — Docker sandbox tier  `[ ]`
**Context brief:** Spec §10. `container` tier: runner + harness in a
per-project container with mounted worktree; sibling containers via mounted
docker socket or rootless nesting; harness-native sandboxes compose inside.
- [ ] **T1** Container runner image + spawn/adopt path. *Accept: golden-path objective completes fully inside a container.*
- [ ] **T2** Tier selection per agent/action-class in policy. *Accept: policy fixture switches tiers; escape-canary test (host file outside worktree untouchable) green.*
**Exit gate:** container golden path + escape canary in CI.

### M2 — Public plugin API  `[ ]`
**Context brief:** Spec §15. Plugin = npm package with manifest (contributes:
`provider|memory-backend|planner|scheduler-job|policy|ui-panel|deploy-target`,
contract version, entry point); loaded by composition root; UI panels as
federated modules; `contracts` is the ABI; conformance suites keep third
parties honest.
- [ ] **T1** Manifest schema + loader + contract-version gating; core plugins consume the public mechanism. *Accept: version-mismatched plugin refused with typed error.*
- [ ] **T2** Third-party install flow (npm/tarball) + sandbox of plugin failures. *Accept: crashing plugin cannot take down the daemon.*
- [ ] **T3** Plugin author guide + `create-aeos-plugin` template repo. *Accept: template builds a working example provider passing conformance.*
**Exit gate:** example third-party plugin installed from a tarball passes conformance.

### M3 — Deploy targets  `[ ]`
**Context brief:** Spec §16. Same code, different placement: user service
(systemd/launchd), docker compose (AEOS_HOME volume), remote posture (token
auth + TLS via reverse proxy).
- [ ] **T1** `aeos service install` (systemd user unit / launchd). *Accept: survives logout/reboot per platform test.*
- [ ] **T2** `docker compose up` target. *Accept: compose quickstart green in CI.*
- [ ] **T3** Remote posture: token auth enforced when binding non-loopback + reverse-proxy TLS guide. *Accept: unauthenticated non-loopback request rejected; guide verified on a VM.*
**Exit gate:** each target's quickstart passes on a clean machine/VM.

### M4 — TCP runner transport + Kubernetes  `[ ]`
**Context brief:** Spec §16. Runner protocol already transport-abstracted;
add authenticated TCP; kernel as Deployment, runners as Jobs/Pods, `AEOS_HOME`
on PVC; contracts unchanged.
- [ ] **T1** TCP transport with mutual auth for the framed runner protocol. *Accept: P1.M3 fuzz + re-adoption suites pass over TCP.*
- [ ] **T2** K8s manifests/Helm chart. *Accept: golden path green on a `kind` cluster in CI (nightly).*
**Exit gate = P4 exit gate** (top of this section).

## Phase P5 — v1.0 public open-source release  `[ ]`

**Exit gate for the phase (= v1 launch):** `v1.0.0` tagged and public; an
outsider installs and completes the quickstart on a clean machine using only
public docs; release artifacts built and signed entirely by CI; announcement
published. **Spine exception (deliberate):** P5.M1–M2 are docs/legal/tooling
only and MAY proceed in parallel from P2 onward; P5.M4–M5 require P4 exit.

### M1 — OSS readiness  `[x]`
**Context brief:** Make the repo safe and welcoming to open. License choice
recorded as an ADR; community health files per GitHub standards; supply-chain
and history hygiene before anything is public.
- [x] **T1** License ADR + `LICENSE` file + `license` field in every package.json. *Accept: ADR merged; `pnpm licenses list` shows no conflict with the chosen license.*
- [x] **T2** Community health files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (vuln reporting), issue/PR templates, `CODEOWNERS`. *Accept: GitHub community-profile checklist 100%.*
- [x] **T3** Dependency + license audit (transitive), `NOTICE` if required. *Accept: audit report committed; zero copyleft contamination.*
- [x] **T4** History/secret hygiene: gitleaks scan over full history; strip private artifacts; branch protection + required CI on `main`. *Accept: gitleaks clean; protection rules active.*
**Exit gate:** repo could be flipped public today with zero legal/security exposure.

### M2 — Docs site + onboarding  `[ ]`
**Context brief:** Public-facing docs generated from this repo (`docs/` stays
the source of truth; the site renders it — no forked content).
- [ ] **T1** Docs site scaffold (Starlight/VitePress) + CI deploy to Pages. *Accept: site builds from `docs/` in CI; broken-link check green.*
- [ ] **T2** Quickstarts per deploy target + first-agent tutorial. *Accept: tech-writer-blind test — a newcomer succeeds using only the site.*
- [ ] **T3** Architecture section rendered from the spec + ADR index. *Accept: spec renders with working section anchors; ADRs listed automatically.*
- [ ] **T4** Demo assets: asciinema of the golden path, UI screenshots/video. *Accept: README embeds them; assets reproducible via a script.*
**Exit gate:** documented quickstart verified by someone who didn't write it.

### M3 — Release engineering  `[ ]`
**Context brief:** Everything ships from CI, nothing from laptops. Changesets
for versioning/changelogs; semver + contracts-compatibility policy documented;
signed artifacts + SBOM.
- [ ] **T1** Changesets (or equivalent) wired: version bumps + changelog generation in CI. *Accept: dry-run release PR produced automatically from a changeset.*
- [ ] **T2** Release pipeline: tag → build npm packages + daemon binaries + Tauri installers, signed, with SBOM. *Accept: `v1.0.0-rc.1` produced entirely by CI from a tag.*
- [ ] **T3** Versioning/compat policy doc (semver, contracts ABI stability, support window). *Accept: policy published on the docs site; contracts package documents its guarantees.*
**Exit gate:** an RC is cut, installed from artifacts, and passes the golden path.

### M4 — Public beta (repo goes public)  `[ ]`
**Context brief:** Soft launch to gather signal before GA. Requires P4 exit +
M1–M3 of this phase.
- [ ] **T1** Flip repo public; enable Issues/Discussions; publish beta announcement to a limited circle. *Accept: repo public with M1 protections verified post-flip.*
- [ ] **T2** Triage workflow: labels, response SLA, ≥10 seeded `good-first-issue`s. *Accept: labels + docs live; response SLA stated in CONTRIBUTING.*
- [ ] **T3** Feedback intake loop: beta findings groomed into this ROADMAP weekly. *Accept: at least one grooming pass recorded in the PM sprint log.*
**Exit gate:** two weeks of beta with all P0/P1 bugs fixed, or ≥2 external PRs merged — whichever comes first.

### M5 — v1.0 GA launch  `[ ]`
**Context brief:** The release itself, then the first week of consequences.
- [ ] **T1** Release-blocker burn-down. *Accept: zero known P0/P1 issues at cut time.*
- [ ] **T2** `v1.0.0`: tag, artifacts, changelog, v0.x upgrade notes. *Accept: upgrade from v0.4 verified; artifacts installable.*
- [ ] **T3** Launch comms: README final polish, blog post, Show HN + X + Reddit posts, awesome-list submissions. *Accept: announcement live and linked from README.*
- [ ] **T4** Post-launch week: issue triage per SLA, hotfix policy exercised (or dry-run). *Accept: retro written into the PM system; hotfix path proven.*
**Exit gate = P5 exit gate = v1 shipped.**

## Post-v1 backlog (tracked, deliberately out of v1 scope)

Source: spec §9, §14, §17.6, §20. Promote to a phase/milestone only via a
ROADMAP commit; never start silently.
- **B1** Direct-API native-loop provider family (OpenRouter/Ollama/SDKs) — contract already allows it (spec §9, OQ2).
- **B2** Multi-user auth / RBAC for team servers (spec §14, OQ3). Token layer from P4.M3 is the foundation.
- **B3** Windows-native runner (spec §17.6, OQ4) — WSL2 documented in the meantime.
- **B4** Postgres state-store swap if SQLite contention ever materializes (spec §17.7).
