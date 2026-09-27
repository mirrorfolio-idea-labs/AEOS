# AEOS / ADE — Project Context (agent onboarding document)

> **Generated view**. As of 2026-09-27, phases **P1–P4 are released**
> (`v0.1.0`–`v0.4.0`) and **P5 is in v1.0 release candidates**.
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
> | Manual/operator steps owed by Kabeer | `guides/` (repo root, gitignored) |
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
work automatically. **ADE** is its web UI (React + Vite + Tailwind, shadcn
conventions; design reference: `mockup.png` at repo root). Working repo name
is ADE; runtime = AEOS.

**This is proven, not aspirational, as of v0.1.0.** The golden-path E2E
(`apps/aeosd/test/golden-path.e2e.test.ts`) spawns the real `aeosd` binary,
drives it through the SDK, `SIGKILL`s it mid-objective, restarts it, and
asserts resume-to-completion — green 10 consecutive times in CI.

Three non-negotiable principles (spec §1):

1. **Files are truth.** All durable state lives in human-readable files under
   `AEOS_HOME` (default `~/.aeos/`). SQLite (`index.db`, WAL) holds only
   derived indexes; `reindex()` rebuilds it from files; deleting it is always
   safe.
2. **Contracts over code.** Every module boundary is a versioned schema
   (`@aeos/contracts`: Zod → exported JSON Schema; `@aeos/api`: OpenAPI 3.1 →
   exported `openapi.json`; both drift-tested in CI). Any module is
   replaceable without touching consumers.
3. **The objective is the recovery unit.** Objectives → plans → tasks with a
   checkpoint after every step. Recovery re-enters the plan at the last
   checkpoint; transcripts are never replayed.

## 2. Locked decisions (do not relitigate)

From spec §2 (D1–D7), each now with an ADR recording the rationale:

- **D1** ([ADR-002](adr/ADR-002-hermetic-subprocess-providers.md)) Execution
  substrate: wrap agent CLIs (Claude Code, OpenCode shipped; Codex in P2) as
  hermetic subprocess providers behind the `HarnessAdapter` interface
  (`@aeos/provider-core`).
- **D2** ([ADR-003](adr/ADR-003-hermetic-harness-hygiene.md)) Hermetic harness
  profiles by default — clean config home per agent; features re-enabled
  per-agent via explicit toggles in `agent.yaml`. Extended by **multi-account
  subscription slots** (M4.T6): a named slot gets its own persistent login
  home so N agents run concurrently on N different Claude Pro/Max accounts.
- **D3** ([ADR-004](adr/ADR-004-typescript-runtime.md)) TypeScript/Node
  runtime, optimized for replaceability, not the language.
- **D4** ([ADR-005](adr/ADR-005-web-first-ui.md)) Web-first UI served by the
  daemon; Tauri desktop wrapper in P2.M8.
- **D5** ([ADR-006](adr/ADR-006-files-as-truth-memory.md)) Memory = files as
  truth + derived indexes (FTS5, shipped M5).
- **D6** ([ADR-007](adr/ADR-007-single-agent-v01-slice.md)) v0.1 slice = one
  persistent agent per objective, resumable across restarts. Scope-amended
  2026-07-19 to include multi-account slots and the OpenCode adapter — both
  still single-agent, no cross-agent coordination.
- **D7** ([ADR-008](adr/ADR-008-modular-kernel-durable-runners.md)) Shape A:
  modular kernel + durable session runners (separate OS processes that
  survive daemon restarts).
- **M3 topology:** the **runner is the Unix-socket server** (listens in its
  session dir); the daemon is the **client** and reconnects using
  `socketPath` from `session.yaml`. This is what makes re-adoption after
  daemon SIGKILL possible.
- **M6 scheduler:** all execution state lives in `plan.md` (checkbox+ID
  grammar, tolerant of human edits) + `checkpoints/<taskId>.yaml`. The
  scheduler checks `<AEOS_HOME>/STOP` before spawning each task — never
  mid-session — so the kill switch never interrupts in-flight work.
- **M7 API:** envelope `{success, data, error, meta}` everywhere; SSE events
  carry their ULID as the SSE id so `Last-Event-ID` reconnects backfill
  exactly-once from the session transcript.
- Wire messages for the daemon↔runner protocol live in `packages/runner`;
  the version constant is `PROTOCOL_VERSION` from `@aeos/contracts`.
- Bus handler errors surface via an error callback, not a synthetic
  `bus.error` event.

## 3. Repository layout and toolchain

pnpm monorepo (`packages/*`, `apps/*`). Node 22 (`.nvmrc`), pnpm 9, ESM,
strict TS, Vitest, Playwright. Remote: `git@github.com:mirrorfolio-idea-labs/AEOS.git`.

```
packages/contracts       @aeos/contracts — dependency root. Event envelope,
                        domain objects, canonical event taxonomy; JSON
                        Schemas generated (committed, drift-tested).
packages/kernel          @aeos/kernel — AEOS_HOME layout, atomic writes,
                        registry, derived SQLite index, event bus, module
                        lifecycle (createKernel/Module).
packages/runner          @aeos/runner — framed protocol, session-runner
                        process, supervisor with boot-time re-adoption.
packages/policy          @aeos/policy — tiered policy (allow/confirm/deny/
                        sandbox), layered YAML, budget meter, co-edit guard.
packages/secrets         @aeos/secrets — age-encrypted store, policy-gated
                        injection, pipeline-wide redaction.
packages/provider-core   @aeos/provider-core — HarnessAdapter contract,
                        describeAdapterConformance suite (behind the
                        /conformance subpath — vitest-dependent), FakeAdapter,
                        managed harness binaries (pinned, integrity-sealed).
packages/provider-claude @aeos/provider-claude — Claude Code adapter:
                        hermetic profile, stream-json translation, resume,
                        BYOK, multi-account slots, usage-limit failover.
packages/provider-opencode @aeos/provider-opencode — same shape, OpenCode.
packages/provider-codex  @aeos/provider-codex — same shape, Codex.
packages/plugins         @aeos/plugins — third-party plugin host: manifest +
                        PLUGIN_ABI_VERSION gate, one process per plugin.
packages/router          @aeos/router — cost-aware model router: pricing
                        index, layered routing.yaml, route/cost records.
packages/memory          @aeos/memory — budgeted files-as-truth store,
                        frozen snapshot composer, propose queue, FTS5
                        search, curator.
packages/scheduler       @aeos/scheduler — plan.md parser (task classes,
                        @agent delegation), checkpoints + recovery, execution
                        loop with 3-strike backoff, verify tasks,
                        retrospectives, durable jobs, the STOP kill switch.
packages/api             @aeos/api — Fastify server, OpenAPI 3.1 (committed
                        openapi.json, drift-tested), SSE, token gate on /v1,
                        kill-switch routes.
packages/sdk             @aeos/sdk — generated OpenAPI types + thin fetch
                        client + dependency-free SSE reader.
apps/aeosd               @aeos/aeosd — daemon composition root: home,
                        index-db, event-bus, supervisor, and (new in M9) an
                        optional `api` module mounting @aeos/api + serving
                        the built ADE UI + resume-on-boot scan.
apps/ade                 @aeos/ade — web UI (React+Vite+Tailwind, shadcn
                        conventions); Playwright suite runs in CI.
apps/cli                 @aeos/cli — `aeos` CLI, thin @aeos/sdk client.
apps/desktop             Tauri 2 shell (Rust): starts/reuses aeosd,
                        notifications, aeos:// deep links.
apps/site                public landing page (React), GitHub Pages root.
apps/docs                Starlight docs site rendered from docs/, under /docs/.
packages/create-aeos-plugin  `npx create-aeos-plugin` scaffolder.
deploy/helm, docker/     Helm chart; daemon + sandbox runner images.
packaging/arch           Arch Linux PKGBUILD (desktop + daemon + CLI).
scripts/release          bundles, upgrade test, TLS recipe verification.
docs/                    spec, ROADMAP, milestone plans, ADRs, markdown PM
                        system (pm/), generated CLI/API reference.
guides/                  gitignored — operator steps only Kabeer can do
                        (live-harness smokes, secrets, machine setup).
```

**Commands** (CI-identical chain, `.github/workflows/ci.yml`):

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise
pnpm -F @aeos/contracts gen:schemas   # regenerate JSON Schemas after touching contracts — commit output
pnpm -F @aeos/api gen:openapi         # regenerate openapi.json after touching api routes — commit output
pnpm -F @aeos/api gen:reference       # then docs/reference/api.md — commit output (drift-tested)
pnpm -F @aeos/cli gen:reference       # docs/reference/cli.md after changing CLI usage — commit output
```

CI also runs the ADE Playwright suite (chromium) and a nightly
secret-gated live-harness E2E (`.github/workflows/nightly-live-e2e.yml`,
safe no-op without `AEOS_NIGHTLY_ANTHROPIC_API_KEY`).

Boundary rule enforced by dependency-cruiser: no package imports another's
internals — published entry points only. `packages/provider-core`'s
conformance suite is exported from a separate `/conformance` subpath
specifically so the main entry point stays importable without vitest as a
runtime dependency (bit us once in M8 — `apps/ade` imports the runtime
entry, not the test suite).

## 4. Architecture (runtime topology, as shipped)

```
clients: ADE web UI (served by aeosd) · aeos CLI · Tauri desktop shell
   │ HTTP + SSE (OpenAPI 3.1 → @aeos/sdk)
aeosd daemon: api module (Fastify, mounted when configured) · event bus ·
              state store (files + SQLite derived index) · supervisor
   │ Unix socket (or TLS-PSK TCP), 4-byte-BE length-prefixed framed JSON,
   │ versioned handshake
session runners (one supervised OS process per live session)
   └─ harness subprocess (claude -p --output-format stream-json /
      opencode run --format json / codex exec --json) in a hermetic
      profile, optionally inside the container sandbox tier
```

Autonomy loop (spec §12, as shipped in M6): `plan.md` (files) → scheduler
picks the first non-completed task, checking `STOP` first → provider adapter
spawns the harness → NDJSON → canonical events → bus → transcript/SSE/
`costs.ndjson` → checkpoint written → advance. 3-strike backoff → task
`blocked`, objective paused, `approval.request` emitted. Resume-on-boot:
`aeosd` scans every agent's `objectives/` on start and restarts any plan
with incomplete, unblocked tasks (`resumeIncompleteObjectives`,
`@aeos/api`) — this is what the golden-path E2E exercises with a real
`SIGKILL`.

On top of that loop (P2–P4): the policy engine gates every action (allow,
confirm via the approvals inbox, deny, or sandbox); budgets are enforced
by the daemon; `autoPlan` objectives get a plan from a read-only planner
session; the router picks provider, model and thinking per task class;
verify tasks gate progress; a retrospective proposes lessons after each
objective; durable jobs wake agents on a schedule; `@agent` tasks delegate
to another agent. Third-party harnesses load as out-of-process plugins.

## 5. Domain model and on-disk layout

Domain objects (all Zod schemas in `@aeos/contracts`): **Workspace** →
**Agent** (harness feature toggles, credentialProfile ref) →
**Objective** / **PlanTask** / **Checkpoint** (now carries a persisted
`attempts` counter), and **Session** with an enforced state machine
`created → starting → running → (waiting_approval|paused) →
completed | failed | orphaned` (`assertSessionTransition` throws
`InvalidTransitionError`). **CredentialProfile**: `subscription` (now with
a `slot` field for multi-account) `| api-key | gateway`. IDs are ULIDs;
session identity is the AEOS ULID, never PIDs or provider ids.

Event envelope: `{v, id, ts, source, agentId?, sessionId?, taskId?, type,
payload}`. Canonical taxonomy: `session.*`, `turn.*`,
`item.(message|tool_call|tool_result|file_change)`, `cost.usage`,
`approval.request` — a discriminated union (`AeosEventSchema`,
`AEOS_EVENT_TYPES`).

`AEOS_HOME` layout (spec §7, all shipped): `aeos.yaml`, `index.db`
(derived), `STOP` (kill switch, when present), `audit/`,
`workspaces/<ws>/workspace.yaml`, `workspaces/<ws>/agents/<agent>/`
containing `agent.yaml`, `memory/` (budgeted, FTS5-indexed),
`objectives/<id>/{objective.md,plan.md,checkpoints/,costs.ndjson}`,
`harness/{claude,opencode}/` (hermetic, per-agent), `subscriptions/<slot>/`
(persistent multi-account login homes, shared across agents using that
slot), `sessions/<sid>/{session.yaml,transcript.ndjson,costs.ndjson}`.
Each agent dir is its own git repo. All writes are atomic (tmp+rename).

Key "database" note: **SQLite is never authoritative.** Write path = files
first; index upserts (session index M2, memory FTS M5) are derived and
provably rebuildable — both have a passing scratch-vs-incremental
equivalence test.

## 6. Current progress — P1–P4 released, P5 in release candidates

| Phase | Status | Evidence |
|---|---|---|
| P1 Spine | released `v0.1.0` | golden-path E2E with `kill -9`, 10× green |
| P2 Safety + polish | released `v0.2.0` | `apps/aeosd/test/p2-exit.e2e.test.ts` |
| P3 Autonomy | released `v0.3.0` | `apps/aeosd/test/p3-exit.e2e.test.ts` |
| P4 Scale + community | released `v0.4.0` | sandbox, compose, Helm (`kind` nightly), plugin-template CI jobs |
| P5 v1.0 public release | `v1.0.0-rc.*` | release pipeline (`release.yml`): bundles, SBOMs, cosign, upgrade test |

Still manual: the live Claude Code and OpenCode smokes (P1.M4, P1.M10), the
service reboot test (P4.M3.T1), and the blind newcomer docs test (P5.M2.T2).
Exact counts live in the [BOARD](pm/BOARD.md); issues mirror every open task
(labels `task`, `phase:P1..P5`, `area:*`).

**Operational facts an agent must know:**

- `guides/<date>-<topic>.md` (gitignored) is where any step needing
  Kabeer's manual effort gets written — check it before assuming a task
  is actually blocked; it usually just needs him to run one command.
- Use Node 22 (`.nvmrc`); CI runs 22. Newer majors can break native
  modules: `better-sqlite3@11` does not compile on Node 26, which is why the
  Arch package builds with a pinned Node 22.
- The ADE Playwright suite (`apps/ade`) is **excluded from the vitest
  workspace** (`vitest.workspace.ts`) — run it with
  `pnpm -F @aeos/ade test`, not `pnpm test`.
- A real bug class to watch for: a package that compiles and tests green
  locally can still be missing its `package.json` dependency declaration
  if the workspace lockfile already resolved the module some other way.
  Verify with `pnpm install --frozen-lockfile` (what CI does), not just
  `pnpm install`, before trusting a green local run of new cross-package
  imports.

## 7. Pending work and dependency chain

What remains before `v1.0.0` is all in ROADMAP P5:

```
P5.M6 public site + install: T1 React landing page · T2 Starlight docs site
      (React islands) · T3 one-line CLI install · T4 desktop downloads +
      auto-update · T5 Markdown docs sweep + generated reference
P5.M4 public beta: T3 weekly grooming (repo already public)
P5.M5 GA: T1 blocker burn-down at cut time → T2 v1.0.0 tag → T3 launch
      comms → T4 post-launch week
```

Post-v1 backlog B1–B4 in ROADMAP — never start silently. Milestone plans
are written **just-in-time** at the predecessor's exit gate.

## 8. Conventions every agent must follow

- **Commits:** conventional commits; any commit advancing a build task ends
  its subject with the task ID: `feat(scheduler): checkpoint resolver [AEOS-P1.M6.T2]`.
  The commit that satisfies a task's accept criteria flips its ROADMAP
  checkbox **in the same commit** (rule R1). No AI attribution lines in
  commit bodies (repo convention), though PR bodies may credit tooling.
- **TDD per step** (RED→GREEN→refactor); accept criteria are test-shaped and
  quoted in the ROADMAP — the test named in the accept is the gate.
- **PM sync rules R1–R6** ([pm/README.md](pm/README.md)): status follows
  commits; docs and code update together; BOARD is a regenerated view
  (never hand-patch facts); **code wins** over docs, with fixes logged in
  the drift register; run the R5 drift scan at milestone exit or cold
  pickup; search `docs/` before creating any new doc (R6).
- **Package boundaries:** new packages copy an existing package's scaffolding
  pattern (tsconfig pair, Vitest, package.json shape — `packages/scheduler`
  or `packages/memory` are good recent templates); import only published
  entry points; `pnpm depcruise` must stay green.
- **Milestone branches:** `feat/aeos-p1-m<N>-<name>` from `main`; merged via
  squash/merge PR at milestone exit after CI is green on the PR itself
  (a clean-clone `frozen-lockfile` install, not just local state).
- Schemas (`packages/contracts`) and the OpenAPI spec (`packages/api`)
  change only with their regenerated committed artifact in the same
  commit — both are drift-tested in CI.
- Nothing may assume single-machine: no absolute paths in contracts, no
  PID-based identity, socket transport abstracted.
- **Manual/operator work → `guides/`**, never left implicit or blocking
  silently. See any file there for the expected format.

## 9. Multi-agent parallelization guide

Ownership boundaries that keep parallel agents from colliding:

| Lane | Scope | Safe in parallel with |
|---|---|---|
| Build lane (one milestone at a time) | the milestone's new package(s) + its `apps/aeosd` wiring | doc lanes below |
| PM/doc lane | BOARD regeneration, sprint logs, drift fixes | build lane (different files) |
| Docs-site lane (P5.M2, any time) | docs site scaffold + content | everything |
| Next-milestone **plan authoring** | `docs/superpowers/plans/` only, and only after the current milestone's exit gate | nothing until that gate passes (just-in-time rule) |

Rules of engagement: (a) one agent per build task ID — claim by minting the
task card or the GitHub issue; (b) never touch another lane's files — the
composition root (`apps/aeosd/src/daemon.ts` and `api-module.ts`) is the
one shared hotspot, so integrate there serially, last; (c) coordination
happens via git + the plan/ROADMAP files, never via shared conversation
context (this mirrors AEOS's own delegation design, spec §12).

## 10. Cold-start checklist for a new agent session

1. Read root [`CLAUDE.md`](../CLAUDE.md), then [`docs/pm/BOARD.md`](pm/BOARD.md)
   (Now/Next/Later + drift register), then check `guides/` for anything
   awaiting the human operator.
2. Run the R5 drift scan if picking up cold: `git log --grep 'AEOS-P'` vs
   ROADMAP markers; `pnpm install --frozen-lockfile && pnpm build && pnpm test`.
3. Pick a milestone from the ROADMAP's next-up phase (§7 above), author its
   plan just-in-time, mint task cards / claim GitHub issues.
4. Work on a milestone branch, TDD, commit with task ID, flip checkbox in
   the completing commit, regenerate BOARD on status change.
5. Before opening a PR: `pnpm install --frozen-lockfile` locally (not just
   `pnpm install`) to catch missing-dependency bugs CI would otherwise
   catch first.
6. At milestone exit: exit-gate test green → flip milestone marker → drift
   scan → close sprint with retrospective → author the next milestone plan.
7. Approval gates are Kabeer's alone: merges to `main` (unless he's
   pre-authorized autonomous merging for a session), scope/spec changes,
   tagging a release. Everything else is self-serve.
8. Releases climb `develop` → `staging` → `main` (`docs/RELEASE.md`). Never
   open a `develop` → `staging` PR while `staging` is the head of an open
   release PR: GitHub stacks them and retargets the second onto `main` when
   the first merges (drift D22).

## 11. Open questions and assumptions

Tracked, not blocking (spec §20): OQ1 human/agent co-edit policy (resolved:
ADR-009, P2.M5); OQ2 direct-API native-loop providers (post-v1, B1); OQ3
multi-user RBAC (post-v1, B2); OQ4 Windows-native runner (post-v1, B3; WSL2
documented meanwhile). Assumptions: Linux/macOS targets for v0.x; the
`apps/ade` Playwright suite requires chromium installed
(`playwright install chromium`) and is not part of `pnpm test`; never run
node-pty under Bun (n/a on Node, recorded for contributors).
