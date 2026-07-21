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

## What is this, actually?

AEOS runs AI coding agents — like Claude Code — as *persistent workers*
instead of chat sessions. You give an agent an objective ("fix this bug",
"add this feature"), it breaks that into a checklist, and it works through
the checklist one item at a time. Every time it finishes an item, it saves
its progress to a plain file on disk.

That last part is the whole point: **if the process crashes, your laptop
dies, or you just close it and come back tomorrow, the agent doesn't
forget anything.** You restart it and it keeps going from the exact item
it was on — the same way a build server picks up a job, not the way a
chat app loses context when you refresh the tab. **ADE** is the web
dashboard where you watch this happen: create an agent, hand it a task,
watch its output stream in, browse the files it's written.

Nothing here is magic — it's a small server (`aeosd`) that runs on your
machine (or eventually a remote box), starts Claude Code as a subprocess
for you, and keeps careful records. If you've used a task queue, a CI
runner, or a process supervisor before, the shape will feel familiar.

<details>
<summary><b>The one-sentence version, for people who want it dense</b></summary>
<br>

> An agent is not a conversation. It is a durable object with identity,
> memory, objectives, and a checkpointed plan. Sessions are cheap disposable
> execution contexts that come and go; the *agent* persists. Recovery never
> replays a transcript — it re-enters the plan at the last completed checkpoint
> and keeps working. `kill -9` the daemon; restart; the agent picks up where
> it stopped.

</details>

### The ideas behind it, explained plainly

<table>
<tr><td><b>Your data is just files</b></td><td>Everything the agent knows — its memory, its progress, its plan — is saved as plain text files you can open, read, and back up yourself. There's a small database for fast search, but it's disposable: delete it and the system rebuilds it from the files. Nothing important lives only in a database.</td></tr>
<tr><td><b>Progress, not conversation, is what survives</b></td><td>The unit of work is a checklist item with a checkpoint, not a chat message. Recovering from a crash means "look at the checklist, find the next unchecked item" — never "try to replay everything that was said."</td></tr>
<tr><td><b>Clean environment per agent</b></td><td>Each agent gets its own private config folder — it never touches your personal Claude Code settings, plugins, or history. You explicitly turn features on per-agent if you want them.</td></tr>
<tr><td><b>Run several accounts side by side</b></td><td>If you juggle multiple clients or Claude subscriptions, each agent can be tied to a different login. Four agents, four separate Claude Pro/Max accounts, running at the same time.</td></tr>
<tr><td><b>A big red stop button</b></td><td>One command (<code>aeos stop --all</code>) halts every agent from starting new work — whatever's already running finishes cleanly first, nothing gets killed mid-edit.</td></tr>
</table>

*(If you want the engineering rationale behind these choices, it's all
written down as ADRs in [`docs/adr/`](docs/adr/).)*

---

## Quickstart

You'll need **Node.js 22** and **pnpm** (a package manager). If you don't
have pnpm yet, Node ships a tool called `corepack` that installs it for
you — that's the second command below.

```bash
git clone https://github.com/mirrorfolio-idea-labs/AEOS.git
cd AEOS
corepack enable
pnpm install
pnpm build
```

Now start the server. If you have an Anthropic API key
(get one at [console.anthropic.com](https://console.anthropic.com/settings/keys)),
use it — the agent will do real work:

```bash
AEOS_HOME=~/.aeos ANTHROPIC_API_KEY=sk-ant-... node apps/aeosd/dist/main.js run
```

**Don't have a key yet, or just want to look around first?** Leave it off
and add `AEOS_PROVIDER=fake` instead — every agent will "run" against a
scripted stand-in that streams believable-looking output instantly, for
free, so you can click through the whole UI before spending anything:

```bash
AEOS_HOME=~/.aeos AEOS_PROVIDER=fake node apps/aeosd/dist/main.js run
```

Either way, open **http://127.0.0.1:7777** in your browser — create a
workspace, add an agent, give it an objective, and watch it stream. Or
skip the browser and drive it from a terminal instead:

```bash
export AEOS_API_URL=http://127.0.0.1:7777
node apps/cli/dist/main.js workspace create acme --name "Acme Corp"
node apps/cli/dist/main.js agent create dev --workspace acme --name "Dev Agent"
node apps/cli/dist/main.js objective create obj1 --workspace acme --agent dev \
  --title "Fix the flaky test" --task "T1: reproduce and fix"
node apps/cli/dist/main.js objective run obj1 --workspace acme --agent dev
```

**Now try the whole point:** while an objective is running, kill the
server (`Ctrl-C`, or `kill -9` if you want to be dramatic about it) and
run the start command again. The objective picks up exactly where it
stopped — no progress lost, nothing re-explained. That one interruption
and recovery is the entire idea this project exists to prove.

Want to run several Claude subscriptions at once (e.g. one per client)?
See [`packages/provider-claude/README.md`](packages/provider-claude/README.md#multi-account-subscriptions).

---

## System overview

*This section is for people who want to know how it actually works
under the hood — skip it if you just wanted to try the thing above.*

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

If you're contributing code, here's the map. It's a monorepo (one Git repo,
many packages) managed with pnpm. `packages/contracts` defines every shared
data shape (what an "agent" looks like, what an "event" looks like); every
other package builds on top of it instead of inventing its own.

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

**Short version: the crash-and-resume behavior described above is real,
tested, and works today.** That was the whole first phase of this
project (called "P1 — Spine"), and it's done. Everything below is the
detailed breakdown for people tracking progress closely.

The Quickstart section above *is* the tested golden path: create agent →
give objective → agent works via a hermetic harness → `kill -9` the
daemon → restart → agent resumes at last checkpoint and completes → all
state inspectable as files.

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
