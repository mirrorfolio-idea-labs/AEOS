# AEOS / ADE — Project Context (agent onboarding document)

> **Generated view** — as of branch `feat/aeos-p1-m3-runner` (M3 complete), 2026-07-18.
> This document is the single-file cold-start context for any AI coding agent
> (Claude Code, Cursor, OpenCode, Codex, …) joining the project. It summarizes
> and **links**; it never owns facts. Owned sources (trust them over this file):
>
> | Fact | Source of truth |
> |---|---|
> | Requirements & architecture | [`docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`](superpowers/specs/2026-07-12-aeos-architecture-design.md) |
> | Task IDs, accept criteria, **status** | [`docs/ROADMAP.md`](ROADMAP.md) (the drift anchor) |
> | Step-level execution detail | milestone plans in [`docs/superpowers/plans/`](superpowers/plans/) |
> | Sprint scope & PM tasks | [`docs/pm/sprints/`](pm/sprints/) |
> | Process rules (R1–R6, delegation) | [`docs/pm/README.md`](pm/README.md) |
> | What is actually true | **the code + git history + test runs** (PM rule R4: code wins) |
>
> If this file disagrees with any of the above, fix this file and log it in the
> [BOARD drift register](pm/BOARD.md#drift-register).

## 1. What this project is

**AEOS** (Autonomous Engineering Operating System) is a local-first daemon
(`aeosd`) that runs durable, resumable AI coding agents. Agents are persistent
engineers owning identity, memory, repositories, objectives, and task history;
sessions are disposable execution contexts. The system survives session limits,
context limits, process crashes, and machine restarts, and resumes interrupted
work automatically. **ADE** is its web UI (design reference: `mockup.png` at
repo root). Working repo name is ADE; runtime = AEOS.

Three non-negotiable principles (spec §1):

1. **Files are truth.** All durable state lives in human-readable files under
   `AEOS_HOME` (default `~/.aeos/`). SQLite (`index.db`, WAL) holds only
   derived indexes; `reindex()` rebuilds it from files; deleting it is always
   safe.
2. **Contracts over code.** Every module boundary is a versioned schema
   (`@aeos/contracts`: Zod → exported JSON Schema, drift-tested in CI). Any
   module is replaceable without touching consumers.
3. **The objective is the recovery unit.** Objectives → plans → tasks with a
   checkpoint after every step. Recovery re-enters the plan at the last
   checkpoint; transcripts are never replayed.

## 2. Locked decisions (do not relitigate)

From spec §2 (D1–D7) plus decisions locked during execution:

- **D1** Execution substrate: wrap agent CLIs (Claude Code, Codex CLI,
  OpenCode) as hermetic subprocess providers behind a `HarnessAdapter`
  interface.
- **D2** Hermetic harness profiles by default — clean config home per agent
  (`CLAUDE_CONFIG_DIR` + `--bare`, `CODEX_HOME`, per-agent `XDG_*`); features
  re-enabled per-agent via explicit toggles in `agent.yaml`.
- **D3** TypeScript/Node runtime, optimized for replaceability, not the
  language.
- **D4** Web-first UI served by the daemon; Tauri desktop wrapper in P2.
- **D5** Memory = files as truth + derived indexes.
- **D6** v0.1 slice = one persistent agent, resumable across restarts.
- **D7** Shape A: modular kernel + durable session runners (separate OS
  processes that survive daemon restarts).
- **M3 topology (locked in the M3 plan):** the **runner is the Unix-socket
  server** (listens in its session dir); the daemon is the **client** and
  reconnects using `socketPath` from `session.yaml`. This is what makes
  re-adoption after daemon SIGKILL possible.
- **workspace.yaml** is part of the `AEOS_HOME` layout (added at M2, promoted
  into spec §7).
- Wire messages for the daemon↔runner protocol live in `packages/runner`;
  the version constant is `PROTOCOL_VERSION` from `@aeos/contracts`.
- Bus handler errors surface via an error callback, not a synthetic
  `bus.error` event.

## 3. Repository layout and toolchain

pnpm monorepo (`packages/*`, `apps/*`). Node 22 (`.nvmrc`), pnpm 9, ESM,
strict TS, Vitest. Remote: `git@github.com:mirrorfolio-idea-labs/AEOS.git`.

```
packages/contracts   @aeos/contracts — THE dependency root. Zod schemas:
                     event envelope, domain objects, canonical event taxonomy;
                     JSON Schemas generated to schemas/*.json (committed,
                     drift-tested). Deps: zod, ulid.
packages/kernel      @aeos/kernel — AEOS_HOME layout + atomic writes (tmp+rename)
                     + YAML codecs; SQLite derived index + reindex; workspace/
                     agent registry (agent dir is a git repo); typed event bus +
                     transcript writer; module lifecycle (createKernel/Module).
                     Deps: contracts, better-sqlite3, yaml.
apps/aeosd           @aeos/aeosd — daemon composition root; wires home,
                     index-db, event-bus as lifecycle modules; run/reindex
                     commands; signal shutdown.
docs/                spec, ROADMAP, milestone plans, markdown PM system (pm/).
```

Planned packages (spec §5, created just-in-time per milestone): `runner` (M3),
`providers/provider-core` + `provider-claude` (M4), `memory` (M5), `scheduler`
+ `planner` (M6), `api` + `sdk` (M7), `apps/ade` (M8), later `policy`,
`router`, `provider-codex`, `provider-opencode`, `apps/cli`, `apps/desktop`.

**Commands** (CI-identical chain, `.github/workflows/ci.yml`):

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise
pnpm -F @aeos/contracts gen:schemas   # regenerate JSON Schemas — commit output
```

CI also fails on schema drift (`gen:schemas` + `git diff --exit-code`).
Boundary rule enforced by dependency-cruiser: no package imports another's
internals — published entry points only.

## 4. Architecture (runtime topology)

```
clients (ADE web UI / Tauri / CLI)
   │ HTTP + SSE (OpenAPI → generated SDK)          [M7–M8]
aeosd daemon: API · policy · event bus · state store (files + SQLite index)
              scheduler · planner · memory · model router
   │ Unix socket, 4-byte-BE length-prefixed framed JSON, versioned handshake
session runners (one supervised OS process per live session)  [M3]
   └─ harness subprocess (claude -p --output-format stream-json / codex exec /
      opencode serve) in hermetic profile, in the agent's git worktree  [M4]
```

Autonomy loop (spec §12): objective file → planner emits plan.md → scheduler
picks task → policy gates → router picks model → runner spawns harness →
provider NDJSON → canonical events → bus → transcript/SSE/cost-meter/audit →
checkpoint written → advance. 3-strike backoff → task `blocked`, objective
paused. Recovery on boot: scan `sessions/*/session.yaml`, mark orphans,
re-enter plans at last checkpoint.

## 5. Domain model and on-disk layout

Domain objects (all Zod schemas in `@aeos/contracts`): **Workspace** →
**Agent** (harness feature toggles, credentialProfile ref) →
**Objective** / **PlanTask** / **Checkpoint**, and **Session** with an enforced
state machine `created → starting → running → (waiting_approval|paused) →
completed | failed | orphaned` (`assertSessionTransition` throws
`InvalidTransitionError`). **CredentialProfile**: `subscription | api-key |
gateway`. IDs are ULIDs; session identity is the AEOS ULID, never PIDs or
provider ids (those are foreign refs in `session.yaml`).

Event envelope: `{v, id, ts, source, agentId?, sessionId?, taskId?, type,
payload}`. Canonical taxonomy: `session.*`, `turn.*`,
`item.(message|tool_call|tool_result|file_change)`, `cost.usage`,
`approval.request` — a discriminated union (`AeosEventSchema`,
`AEOS_EVENT_TYPES`) with a golden-fixture exhaustiveness test.

`AEOS_HOME` layout (spec §7): `aeos.yaml`, `index.db` (derived), `audit/`,
`workspaces/<ws>/workspace.yaml`, `workspaces/<ws>/agents/<agent>/` containing
`agent.yaml`, `memory/`, `objectives/<id>/{objective.md,plan.md,checkpoints/}`,
`harness/{claude,codex,opencode}/`, `worktrees/<repo>/<branch>/`,
`sessions/<sid>/{session.yaml,transcript.ndjson,costs.ndjson}`. Each agent dir
is its own git repo (portability: copy dir + `aeos reindex`). All writes are
atomic (tmp+rename), crash-sim tested.

Key "database" note: **SQLite is never authoritative.** Write path = files
first; index upserts are derived. Any new feature must keep
`reindex()`-from-files equivalence green.

## 6. Current progress (as of `5a78ee5`)

| Milestone | Status | Evidence |
|---|---|---|
| P1.M1 contracts (T1–T6) | **done** | merged `8506974`; 19/19 tests; CI chain green locally |
| P1.M2 kernel (T1–T5) | **done** | merged `ec64562`; 69/69 tests; crash-sim ×100 + reindex-equivalence exit gate green |
| P1.M3 session runner (T1–T4) | **done** | complete on `feat/aeos-p1-m3-runner`; flagship re-adoption test green; 100/100 workspace tests |
| P1.M4 Claude provider (T1–T5) | **next** | plan authored ([M4 plan](superpowers/plans/2026-07-18-aeos-p1-m4-claude-provider.md)); **sprint S04 gate: awaiting Kabeer's approval before execution** |
| P1.M5–M9, P2–P5 | pending | 104 total tasks defined; 15 done, 89 remain to v1.0 |

Active sprint: [S04](pm/sprints/S04.md) — goal: M4 conformance + golden
translation green. Pending Kabeer: M3 branch merge to `main` + first push.
Blockers: none. All drift-register items D1–D7 are fixed.

**Operational facts an agent must know:**

- `main` is **~28 commits ahead of `origin/main` — never pushed**. Remote CI
  has therefore never run. First push is a known carry-over from the S02
  retrospective.
- `.superpowers/sdd/progress.md` is a **stale** scratch ledger (stops at M2
  Task 1 despite M2 being fully merged). Do not trust it; ROADMAP owns status.
- Deferred minor from M2 review: `readYaml` collapses ENOENT vs corrupt into
  one `CodecError` — M3+ code needing to distinguish should use
  `err.cause.code`.

## 7. Pending work and dependency chain

Strict single-spine ordering (spec §17.8): **nothing in milestone N+1 starts
until N's exit gate passes**; milestone plans are written just-in-time at the
predecessor's exit. The chain through v0.1:

```
M3 runner — DONE (runner-as-server, ring-buffer replay, re-adoption, state machine)
 → M4 Claude provider (5 tasks, plan ready; hermetic profile, NDJSON→canonical, resume, BYOK failover)
 → M5 memory v0 (4 tasks; budgeted files, frozen snapshot, memory.propose, FTS)
 → M6 scheduler v0 (4 tasks; plan parser, checkpoints, sequential loop, resume-on-boot — heart of P1)
 → M7 API+SSE+SDK (4) → M8 ADE web UI (4) → M9 E2E + hardening (4) = v0.1 tag
```

P1 exit gate (the golden-path demo): create agent → objective → agent works
via hermetic Claude Code → `kill -9` daemon → restart → resumes at last
checkpoint → completes → all state inspectable as files.

Within-M3 task order: T1 (framed codec + handshake) → T2 (runner process, ring
buffer, STOP file) → T3 (supervisor + re-adoption, the flagship integration
test) → T4 (session state machine enforcement). T1 and the T2 ring buffer are
independent; T3 depends on T1+T2; T4 can proceed in parallel with T3 (only
composition-root wiring overlaps).

Then P2 (safety: policy, budgets, secrets, curator, PTY, Codex/OpenCode
adapters, Tauri) → P3 (autonomy: planner classes, model router, verification
tasks, retrospective loop, wakeups/delegation) → P4 (Docker sandbox, plugin
API, deploy targets, K8s) → P5 (OSS release; P5.M1–M2 may run in parallel
from P2 onward). Post-v1 backlog B1–B4 in ROADMAP — never start silently.

## 8. Conventions every agent must follow

- **Commits:** conventional commits; any commit advancing a build task ends
  its subject with the task ID: `feat(runner): framed codec [AEOS-P1.M3.T1]`.
  The commit that satisfies a task's accept criteria flips its ROADMAP
  checkbox **in the same commit** (rule R1). No AI attribution lines.
- **TDD per step** (RED→GREEN→refactor); accept criteria are test-shaped and
  quoted in the ROADMAP — the test named in the accept is the gate.
- **PM sync rules R1–R6** ([pm/README.md](pm/README.md)): status follows
  commits; docs and code update together; BOARD/TRACEABILITY are regenerated
  views (never hand-patch facts); **code wins** over docs, with fixes logged
  in the drift register; run the R5 drift scan at milestone exit or cold
  pickup; search `docs/` before creating any new doc (R6).
- **Package boundaries:** new packages copy the `packages/kernel` scaffolding
  pattern (tsconfig pair, Vitest, package.json shape); import only published
  entry points; `pnpm depcruise` must stay green.
- **Milestone branches:** `feat/aeos-p1-m<N>-<name>` from `main`; merged
  `--no-ff` at milestone exit after the exit gate passes.
- **Delegation cards** (`docs/pm/tasks/<ID>.md`, template `_TEMPLATE.md`) are
  minted just-in-time only for tasks entering execution, written so a
  zero-history agent can execute them; archived on completion.
- Schemas change only with regenerated `schemas/*.json` in the same commit.
- Nothing may assume single-machine: no absolute paths in contracts, no
  PID-based identity, socket transport abstracted.

## 9. Multi-agent parallelization guide

Ownership boundaries that keep parallel agents from colliding:

| Lane | Scope | Safe in parallel with |
|---|---|---|
| Build lane (one milestone at a time) | the milestone's new package + its `apps/aeosd` wiring | doc lanes below |
| PM/doc lane | BOARD/TRACEABILITY regeneration, sprint logs, drift fixes | build lane (different files) |
| P5.M1–M2 lane (from P2 onward) | LICENSE/ADRs/community files, docs site | everything |
| Future: next-milestone **plan authoring** | `docs/superpowers/plans/` only | current milestone execution |

Rules of engagement: (a) one agent per build task ID — claim by minting the
task card; (b) within M3, T1 and T2 can run as two agents (protocol vs runner
core) meeting at T3; (c) never touch another lane's files — the composition
root (`apps/aeosd/src/daemon.ts`) is the one shared hotspot, so integrate
there serially, last; (d) coordination happens via git + the plan/ROADMAP
files, never via shared conversation context (this mirrors AEOS's own
delegation design, spec §12).

## 10. Cold-start checklist for a new agent session

1. Read root [`CLAUDE.md`](../CLAUDE.md), then [`docs/pm/BOARD.md`](pm/BOARD.md)
   (Now/Next/Later + drift register), then the active sprint file.
2. Run the R5 drift scan if picking up cold: `git log --grep 'AEOS-P'` vs
   ROADMAP markers; `pnpm install && pnpm build && pnpm test`.
3. Pick up the task: its card in `docs/pm/tasks/` (mint from `_TEMPLATE.md` if
   absent), step detail in the milestone plan, accept criterion in ROADMAP.
4. Work on the milestone branch, TDD, commit with task ID, flip checkbox in
   the completing commit, regenerate views on status change.
5. At milestone exit: exit-gate test green → flip milestone marker → drift
   scan → archive cards → close sprint with retrospective → author the next
   milestone plan.
6. Approval gates are Kabeer's alone: milestone-plan approval before sprint
   execution, merges to `main`, scope/spec changes (pm/README ownership
   defaults). Everything else is self-serve.

## 11. Open questions and assumptions

Tracked, not blocking (spec §20): OQ1 human/agent co-edit policy (resolved by
ADR in P2.M5); OQ2 direct-API native-loop providers (post-v1, B1); OQ3
multi-user RBAC (post-v1, B2); OQ4 Windows-native runner (post-v1, B3; WSL2
documented meanwhile). Assumptions: Linux/macOS targets for v0.x; Vitest
workspace globs `packages/*` **and** `apps/*` (an empty `apps/` dir with only
`.gitkeep` breaks it — historical incident, D6/obs); never run node-pty under
Bun (n/a on Node, recorded for contributors).
