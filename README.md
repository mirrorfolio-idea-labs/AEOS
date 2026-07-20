<p align="center">
<pre align="center">
 █████╗ ███████╗ ██████╗ ███████╗
██╔══██╗██╔════╝██╔═══██╗██╔════╝
███████║█████╗  ██║   ██║███████╗
██╔══██║██╔══╝  ██║   ██║╚════██║
██║  ██║███████╗╚██████╔╝███████║
╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝
     Autonomous Engineering Operating System
</pre>
</p>

<p align="center">
  <strong>The autonomous engineering OS where the agent — not the chat — is the durable object.</strong>
</p>

<p align="center">
  <a href="./docs/ROADMAP.md"><img src="https://img.shields.io/badge/Phase-P1%20Spine%20(v0.1)-blueviolet?style=for-the-badge" alt="Phase P1"></a>
  <a href="https://github.com/mirrorfolio-idea-labs/AEOS/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mirrorfolio-idea-labs/AEOS/ci.yml?style=for-the-badge&label=CI" alt="CI status"></a>
  <a href="./docs/pm/BOARD.md"><img src="https://img.shields.io/badge/Status-alpha-orange?style=for-the-badge" alt="Status"></a>
  <a href="https://www.npmjs.com/package/pnpm"><img src="https://img.shields.io/badge/pnpm-9-f69220?style=for-the-badge&logo=pnpm&logoColor=white" alt="pnpm 9"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node-22-017ace?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 22"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License MIT"></a>
</p>

<p align="center">
  Runtime: <code>aeosd</code> daemon &nbsp;·&nbsp; UI: <code>ADE</code> web/desktop &nbsp;·&nbsp; Built by <a href="https://github.com/mirrorfolio-idea-labs">Mirrorfolio</a>
</p>

---

> An agent is not a conversation. It is a durable object with identity,
> memory, objectives, and a checkpointed plan. Sessions are cheap disposable
> execution contexts that come and go; the *agent* persists. Recovery never
> replays a transcript — it re-enters the plan at the last completed checkpoint
> and keeps working. `kill -9` the daemon; restart; the agent picks up where
> it stopped.

**AEOS** is the runtime — a local-first daemon that supervises durable,
resumable AI coding agents whose entire state lives as files. **ADE** is its
web UI. We build one to prove a thesis: that an AI engineer can be a
persistent first-class object — not a chat, not a prompt, not a session token
in someone else's database.

<table>
<tr><td><b>Files are truth</b></td><td>All durable state — memory, transcripts, plans, checkpoints, costs — lives in human-readable files. The SQLite index is <i>derived</i> and rebuildable. If <code>rm -rf index.db</code> is not a safe and routine operation, we have failed.</td></tr>
<tr><td><b>Contracts over code</b></td><td>Every module boundary is a versioned, schema-defined wire contract (JSON Schema, Zod, NDJSON events, OpenAPI). Any module can be replaced or rewritten without its consumers noticing.</td></tr>
<tr><td><b>The objective is the recovery unit</b></td><td>Autonomy is structured as durable <i>objectives → plans → tasks</i> with a checkpoint after every step. There is no "resume the chat." There is only "re-enter the plan."</td></tr>
<tr><td><b>Hermetic harnesses</b></td><td>Each harness (Claude Code, OpenCode) runs in a clean config home by default — no user plugins, skills, or global config leak in. Features re-enabled per-agent via explicit toggles.</td></tr>
<tr><td><b>Multiple accounts, at once</b></td><td>Named subscription slots give every agent its own persistent Claude Pro/Max login — run four client projects on four accounts, concurrently, without touching your personal login.</td></tr>
<tr><td><b>Kill switch, always</b></td><td>A single <code>STOP</code> file halts every scheduler from spawning new work; in-flight sessions finish cleanly. <code>aeos stop --all</code> / <code>aeos resume-ops</code>.</td></tr>
</table>

---

## Quickstart

Requirements: **Node 22** (`.nvmrc`), **pnpm 9** (via corepack), and the
[Claude Code CLI](https://docs.claude.com/en/docs/claude-code) if you want
real (not fake-provider) sessions.

```bash
git clone https://github.com/mirrorfolio-idea-labs/AEOS.git
cd AEOS
corepack enable
pnpm install
pnpm build

# start the daemon — mounts the API + the built ADE UI on :7777
AEOS_HOME=~/.aeos ANTHROPIC_API_KEY=sk-ant-... node apps/aeosd/dist/main.js run
```

Open **http://127.0.0.1:7777** — create a workspace, add an agent, run an
objective, watch it stream. Or drive it from the CLI:

```bash
export AEOS_API_URL=http://127.0.0.1:7777
node apps/cli/dist/main.js workspace create acme --name "Acme Corp"
node apps/cli/dist/main.js agent create dev --workspace acme --name "Dev Agent"
node apps/cli/dist/main.js objective create obj1 --workspace acme --agent dev \
  --title "Fix the flaky test" --task "T1: reproduce and fix"
node apps/cli/dist/main.js objective run obj1 --workspace acme --agent dev
```

Kill the daemon mid-objective (`Ctrl-C` or `kill -9`) and start it again —
the plan resumes exactly where it left off, no data lost. That's the whole
thesis, demonstrated in one command.

Multiple Claude subscriptions (e.g. one per client)? See
[`packages/provider-claude/README.md`](packages/provider-claude/README.md#multi-account-subscriptions).

---

## System overview

```
┌────────────────────────────────────────────────────────────┐
│  ADE (web UI, React+Tailwind)         CLI (aeos)            │  clients
└──────────────┬─────────────────────────────────────────────┘
               │ HTTP + SSE (OpenAPI 3.1; generated SDK)
┌──────────────▼─────────────────────────────────────────────┐
│  aeosd — kernel daemon                                      │
│  ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌────────────────┐    │
│  │ API       │ │ Scheduler│ │ Event   │ │ State store    │   │
│  │ gateway   │ │ (plan/   │ │ bus     │ │ (files+SQLite  │   │
│  │ (Fastify) │ │ checkpt) │ │         │ │  derived index)│   │
│  └──────────┘ └─────────┘ └─────────┘ └────────────────┘    │
│  ┌────────────────────────┐ ┌───────────────────────────┐   │
│  │ Memory (files + FTS5)  │ │ Provider adapters (Claude, │   │
│  │                        │ │ OpenCode — hermetic)       │   │
│  └────────────────────────┘ └───────────────────────────┘   │
└──────────────┬─────────────────────────────────────────────┘
               │ Unix socket, framed versioned protocol
┌──────────────▼─────────────────────────────────────────────┐
│  Session runners — one supervised process per live session, │
│  survives daemon restarts, re-adopted by session ID          │
└────────────────────────────────────────────────────────────┘
```

**Data flow, one autonomous step:** Objective → plan.md (checklist,
stable task IDs) → Scheduler picks the first incomplete task → provider
adapter spawns the harness in a hermetic profile → NDJSON output
translated into canonical events → event bus → transcript (NDJSON) + SSE
to clients + `costs.ndjson` → task completes → checkpoint written →
scheduler advances. A crash at any point resumes at the same task on
restart — nothing is ever replayed from a transcript.

---

## Repository

pnpm monorepo. `packages/contracts` is the dependency root — Zod schemas
for the event envelope, domain objects, and canonical event taxonomy,
exported also as JSON Schema. Everything else depends on `contracts` and
on each other's published entry points only; dependency-cruiser enforces
it in CI.

```
aeos/
├── packages/
│   ├── contracts/          # Zod schemas → JSON Schemas; event envelope; protocol versions
│   ├── kernel/              # AEOS_HOME layout, registry, event bus, SQLite derived index
│   ├── runner/               # session-runner process + supervisor + framed protocol
│   ├── provider-core/        # HarnessAdapter contract + conformance suite + provider-fake
│   ├── provider-claude/      # Claude Code hermetic adapter (BYOK, multi-account slots)
│   ├── provider-opencode/    # OpenCode hermetic adapter
│   ├── memory/                # file memory (budgeted) + frozen snapshots + FTS5 search
│   ├── scheduler/             # plan.md + checkpoints; the objective execution loop
│   ├── api/                   # Fastify server, OpenAPI 3.1, SSE, kill switch
│   └── sdk/                   # generated TS client + SSE reader from the OpenAPI spec
├── apps/
│   ├── aeosd/               # daemon composition root (the `aeosd` binary)
│   ├── ade/                  # web UI (React + Vite + Tailwind, shadcn conventions)
│   └── cli/                   # `aeos` CLI (thin SDK client)
└── docs/                     # specs, plans, ADRs, ROADMAP, PM board
```

---

## Status

**Phase P1 — Spine (v0.1) is complete.** The golden path is real and
tested: *create agent → give objective → agent works via a hermetic
harness → `kill -9` the daemon → restart → agent resumes at last
checkpoint and completes → all state inspectable as files.*

| Milestone | Status | What it is |
|---|---|---|
| M1 contracts | `[x]` | Zod schemas, event taxonomy, JSON Schema export |
| M2 kernel | `[x]` | AEOS_HOME layout, registry, event bus, derived SQLite index |
| M3 runner | `[x]` | Session-runner process + supervisor + framed protocol |
| M4 Claude provider | `[x]`¹ | Hermetic profile, translation, resume, BYOK, multi-account slots |
| M5 memory v0 | `[x]` | Budgeted files-as-truth store, frozen snapshots, FTS5 search |
| M6 scheduler v0 | `[x]` | plan.md + checkpoints, 3-strike backoff, crash resume |
| M7 API + SSE + SDK | `[x]` | OpenAPI 3.1, exactly-once SSE, generated client, CLI |
| M8 ADE web UI | `[x]` | React UI, live session console, files browser, BYOK, cost meter |
| M9 E2E + hardening | `[x]` | Real-process golden-path E2E (10× green), kill switch, this README |
| M10 OpenCode adapter | `[x]`¹ | Second hermetic harness, same conformance bar as Claude |

¹ Code-complete and merged; gated only on a manual live-harness smoke
test before the final checkbox flips (tracked in the project's internal
guides — the automated suite is green either way).

After P1: **P2** (safety + policy engine, budgets, secrets, v0.2), **P3**
(autonomy — planner, model routing, self-learning, v0.3), **P4** (scale +
plugin ecosystem, v0.4), **P5** (public v1.0 launch — OSS readiness is
already done). See [`docs/ROADMAP.md`](docs/ROADMAP.md) for all 107
tracked tasks, and [open issues](https://github.com/mirrorfolio-idea-labs/AEOS/issues)
for ones ready to pick up.

---

## Build, test, run

Node 22, pnpm 9, ESM, strict TypeScript, Vitest, Playwright.

```bash
pnpm install
pnpm build
pnpm test          # workspace-wide vitest
pnpm typecheck
pnpm depcruise     # package-boundary enforcement
```

CI-identical chain:

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise
```

Regenerate committed generated artifacts after touching their sources
(both are drift-tested in CI):

```bash
pnpm -F @aeos/contracts gen:schemas    # after editing packages/contracts
pnpm -F @aeos/api gen:openapi          # after editing packages/api routes
```

Run the ADE UI's Playwright suite:

```bash
pnpm -F @aeos/ade exec playwright install chromium
pnpm -F @aeos/ade test
```

---

## Read first

| Doc | What's there |
|-----|--------------|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to pick up an issue and ship a PR |
| [`docs/pm/BOARD.md`](docs/pm/BOARD.md) | Current status, active sprint, drift register |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | The drift anchor — stable task IDs, accept criteria |
| [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md) | Single-file cold-start onboarding |
| [`docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`](docs/superpowers/specs/2026-07-12-aeos-architecture-design.md) | Full architecture design |
| [`docs/adr/`](docs/adr/) | Architecture decision records |

---

## Conventions

- **Conventional commits.** Every commit advancing a build task ends its
  subject with the stable task ID: `feat(contracts): event envelope [AEOS-P1.M1.T2]`.
- The commit that completes a task flips its ROADMAP checkbox in the same
  commit.
- **Milestone plans are just-in-time** — written only after the previous
  milestone's exit gate passes, never speculatively.
- **No cross-package internal imports** — packages talk through published
  entry points (`@aeos/x`), never relative paths into `src/`.
- **Facts are the code.** Docs describe intent; code and git history are the
  facts. On any inconsistency, trust the code, fix the doc, log the drift.

## Contributing

Issues are labeled and milestone-tagged; `good first issue` +
`help wanted` mark self-contained entry points. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

[MIT](LICENSE) — see [ADR-001](docs/adr/ADR-001-license-mit.md) for the
rationale.

---

> AEOS is built by Mirrorfolio. It is alpha software with a complete,
> tested spine — the golden path works today. Watch the
> [BOARD](docs/pm/BOARD.md), not the hype.
