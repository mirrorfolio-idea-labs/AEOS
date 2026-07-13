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
  <a href="./packages/contracts"><img src="https://img.shields.io/badge/Contracts-17%2F17%20tests%20green-brightgreen?style=for-the-badge" alt="Contracts tests"></a>
  <a href="./docs/pm/BOARD.md"><img src="https://img.shields.io/badge/Status-pre--alpha-orange?style=for-the-badge" alt="Status"></a>
  <a href="https://www.npmjs.com/package/pnpm"><img src="https://img.shields.io/badge/pnpm-9-f69220?style=for-the-badge&logo=pnpm&logoColor=white" alt="pnpm 9"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node-22-017ace?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 22"></a>
  <img src="https://img.shields.io/badge/License-TBD%20(%20P5.M1%20)-lightgrey?style=for-the-badge" alt="License TBD">
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

We are not shipping a wrapper around a chat box. We are shipping the
substrate that makes an agent *survive*.

<table>
<tr><td><b>Files are truth</b></td><td>All durable state — memory, transcripts, plans, checkpoints, policy, audit — lives in human-readable files. Databases and vector indexes are <i>derived</i> and rebuildable. The model's context window is a cache over file state, never the source of truth. If <code>rm -rf index.db</code> is not a safe and routine operation, we have failed.</td></tr>
<tr><td><b>Contracts over code</b></td><td>Every module boundary is a versioned, schema-defined wire contract (JSON Schema, Zod, NDJSON events, OpenAPI). Any module can be replaced, extracted to its own service, or rewritten in another language without its consumers noticing. TypeScript is the implementation detail of v0.1, not a commitment.</td></tr>
<tr><td><b>The objective is the recovery unit</b></td><td>Autonomy is structured as durable <i>objectives → plans → tasks</i> with a checkpoint after every step. There is no "resume the chat." There is only "re-enter the plan."</td></tr>
<tr><td><b>Headless by default</b></td><td>JSON streaming is the default execution mode; a PTY attach is the human-takeover escape hatch, not the main loop — opposite of every chat-box wrapper.</td></tr>
<tr><td><b>Hermetic harnesses</b></td><td>Each harness runs in a clean config home by default — no user plugins, skills, or global config leak in. Prevents corruption of agent self-learning by the host machine's customizations; features re-enabled per-agent via explicit toggles.</td></tr>
<tr><td><b>Daemon-enforced budgets</b></td><td>Per-agent and per-objective cost caps enforced by the daemon, not the model. A free-running loop never spends unbounded; gates and budgets are externally imposed.</td></tr>
<tr><td><b>Provider-agnostic by accident</b></td><td>We wrap agent CLIs (Claude Code, Codex CLI, OpenCode) as hermetic subprocess providers. The adapter is the only thing that knows a provider exists — swap models with no downstream change.</td></tr>
</table>

---

## Locked decisions

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Execution substrate | Wrap agent CLIs as hermetic subprocess providers | Inherit mature tool loops; fastest path to working; adapter keeps us provider-agnostic |
| D2 | Harness hygiene | Clean config home by default — no user plugins/skills/global config leak in | Prevents corruption of agent self-learning by the host machine's customizations |
| D3 | Runtime language | TypeScript/Node — architecture optimized for *replaceability*, not the language | Ecosystem fit (CLIs, MCP, UI); contracts make the language swappable later |
| D4 | UI | Web-first served by the daemon; thin Tauri wrapper for desktop | One UI codebase covers desktop and cloud |
| D5 | Memory | Files as truth + derived indexes | Inspectable, diffable, portable, crash-proof |
| D6 | v0.1 slice | One persistent agent, resumable across restarts | Proves the core thesis before multi-agent complexity |
| D7 | Shape | Modular kernel + durable session runners | Replaceable modules in one daemon; sessions survive daemon/UI restarts |

---

## What we take from whom

We stand on prior art. We name it, we say what we take, and we say what we
reject. Nothing here is invented in a vacuum.

| Source | Take | Reject |
|--------|------|--------|
| **Superset** | Standalone session-runner daemon over a Unix socket; per-session ring buffers; versioned framed protocol; fd-handoff across daemon upgrades; worktree-per-task | Postgres+ElectricSQL sync as truth; macOS-only Electron coupling |
| **Hermes** | Hard char-budgeted memory files; overflow = explicit error the agent must resolve (no silent truncation); frozen-snapshot memory for prompt-cache stability; background Curator that ages and archives but never deletes; FTS + summarization for cross-session recall | Single-memory-provider limitation; two-file layout |
| **Conductor** | The "harness" abstraction; managed harness binaries with BYO fallback; gitignored per-workspace scratch; workspace-as-unit-of-review | Auth passthrough as the only mode; closed source; no headless mode |
| **OpenCode** | Server-owns-sessions / clients-are-thin; OpenAPI → generated SDK; SSE event bus; config-dir layering with explicit disable flags | Sessions as opaque provider JSON; the Effect framework (we take patterns, not the dependency) |
| **Codex CLI** | `thread/turn/item` event taxonomy; sandbox-mode-as-flag; `resume --last` two-stage pipelines | Rollout files as canonical transcript |
| **Claude Code** | `stream-json` NDJSON events; `total_cost_usd` per invocation; `CLAUDE_CONFIG_DIR` + `--bare` + granular `CLAUDE_CODE_DISABLE_*` flags for hermetic profiles | — |
| **OpenRouter** | `/models` pricing/context metadata as a local routing index; OpenAI-compatible fallback routing | — |
| **vibe-kanban / gpt-pilot / Aider / SWE-agent / AutoGPT** | Durable object = the task not the chat; checkpoint-after-every-step; architect/editor two-model cost split; ACI beats model choice; free-running loops need externally imposed structure (budgets, gates) | — |

**Three differentiators no existing tool has, all at once:** (a) headless
JSON-streaming as the *default* execution mode with PTY attach as a
human-takeover escape hatch; (b) daemon-enforced per-agent / per-objective
budget caps; (c) hermetic harness profiles by default.

---

## System overview

```
┌────────────────────────────────────────────────────────────┐
│  ADE (web UI)          Desktop wrapper (Tauri)    CLI      │  clients
└──────────────┬─────────────────────────────────────────────┘
               │ HTTP + SSE (OpenAPI; generated SDK)
┌──────────────▼─────────────────────────────────────────────┐
│  aeosd — kernel daemon                                     │
│  ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌────────────────┐   │
│  │ API       │ │ Policy  │ │ Event   │ │ State store    │   │
│  │ gateway   │ │ engine  │ │ bus     │ │ (files+SQLite  │   │
│  └──────────┘ └─────────┘ └─────────┘ │  derived index) │   │
│  ┌──────────┐ ┌─────────┐ ┌─────────┐ └────────────────┘   │
│  │ Scheduler │ │ Planner │ │ Memory  │ ┌────────────────┐   │
│  │           │ │         │ │ system  │ │ Model router   │   │
│  └──────────┘ └─────────┘ └─────────┘ └────────────────┘   │
└──────────────┬─────────────────────────────────────────────┘
               │ Unix socket / TCP (framed, versioned protocol)
┌──────────────▼─────────────────────────────────────────────┐
│  Session runners (one supervised process per live session) │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ runner ── harness subprocess (claude -p / codex exec  │ │
│  │           / opencode serve) in hermetic profile,      │ │
│  │           inside sandbox, in agent's git worktree    │ │
│  └───────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

**Data flow, one autonomous step:**

```
Objective (file) → Planner emits/updates Plan (file) → Scheduler picks Task
→ Policy engine gates permission tier & budget
→ Model router picks provider + model for the task class
→ Runner spawns harness in hermetic profile + sandboxed worktree
→ Harness NDJSON events → normalized AEOS events → event bus
   → transcript file (append-only NDJSON)   → SSE to clients
   → cost meter (budget enforcement)        → audit log
→ Task completes → checkpoint written → memory writes proposed
→ Scheduler advances plan (or Planner revises) → next task
```

The kernel daemon is restartable at any moment. Session runners are separate
OS processes that survive daemon restarts and are re-adopted by durable
session ID on reconnect. Clients are thin — the web UI, desktop wrapper, and
CLI all speak the same OpenAPI + SSE surface, and nothing in the UI holds
state the daemon doesn't.

---

## Repository

pnpm monorepo. `packages/contracts` is the dependency root — Zod schemas for
the event envelope, domain objects, and canonical event taxonomy, exported
also as JSON Schema. Everything else depends on `contracts` and on each
other's published entry points only; dependency-cruiser enforces it in CI.

```
aeos/
├── packages/
│   ├── contracts/        # Zod schemas → JSON Schemas; event envelope; protocol versions
│   ├── kernel/           # registry, event bus, state store, lifecycle       (planned)
│   ├── policy/           # permission tiers, budget caps, audit              (planned)
│   ├── memory/           # file memory + derived indexes + curator            (planned)
│   ├── scheduler/        # durable queues, wakeups, resume-on-boot           (planned)
│   ├── planner/          # objective → plan → tasks; plan revision           (planned)
│   ├── router/           # cost/quality model routing                        (planned)
│   ├── runner/           # session-runner process + supervisor + protocol    (planned)
│   ├── providers/        # harness adapters (claude / codex / opencode)      (planned)
│   ├── api/              # Fastify server, OpenAPI spec, SSE                 (planned)
│   └── sdk/              # generated TS client from OpenAPI                   (planned)
├── apps/
│   ├── aeosd/            # daemon assembly (composition root)                 (planned)
│   ├── ade/              # web UI (React + xterm.js)                          (planned)
│   ├── desktop/          # Tauri wrapper around ade                           (planned)
│   └── cli/              # aeos CLI (thin SDK client)                         (planned)
└── docs/                 # specs, plans, ADRs, ROADMAP, PM board
```

---

## Status

Phase **P1 — Spine (v0.1)** is in flight. The goal of P1 is one golden-path
demo: *create agent → give objective → agent works via hermetic Claude Code →
`kill -9` the daemon → restart → agent resumes at last checkpoint and
completes → all state inspectable as files.*

| Milestone | Status | What it is |
|---|---|---|
| **M1** contracts | `[~]` in progress | Monorepo scaffold, Zod schemas, event taxonomy, JSON Schema export, depcruise + CI |
| M2 kernel | `[ ]` | State store, registry, event bus |
| M3 runner | `[ ]` | Session-runner process + supervisor + protocol |
| M4 Claude provider | `[ ]` | First hermetic harness adapter |
| M5 memory v0 | `[ ]` | File memory + derived FTS index |
| M6 scheduler v0 | `[ ]` | Durable queues, resume-on-boot |
| M7 API + SSE + SDK | `[ ]` | OpenAPI surface, generated client |
| M8 ADE web UI | `[ ]` | The web front-end |
| M9 E2E + hardening | `[ ]` | P1 exit gate, tags `v0.1` |

**State of the art today:** the contracts package is real and tested — 17/17
tests green, JSON Schema export with a drift test, `pnpm build` / `typecheck`
/ `test` all pass cleanly. Everything downstream is designed, planned, and
gated on M1's exit.

After P1: **P2** (safety + polish, v0.2), **P3** (autonomy, v0.3),
**P4** (scale + community, v0.4), **P5** (v1.0 public release). 104 tasks
defined across 31 milestones to v1; 5 done, 99 remain.

---

## Build, test, run

Node 22, pnpm 9, ESM, strict TypeScript, Vitest.

```bash
pnpm install
pnpm build
pnpm test          # 17 passing
pnpm typecheck
pnpm depcruise     # boundary enforcement (lands with M1.T6)
```

CI-identical chain:

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise
```

Regenerate committed JSON Schemas after touching `packages/contracts`:

```bash
pnpm -F @aeos/contracts gen:schemas    # output is committed; drift test catches divergence in CI
```

---

## Read first

| Doc | What's there |
|-----|--------------|
| [`docs/pm/BOARD.md`](docs/pm/BOARD.md) | Current status, active sprint, drift register |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | The drift anchor — stable task IDs, accept criteria |
| [`docs/pm/README.md`](docs/pm/README.md) | The PM operating manual (source-of-truth map, sync rules) |
| [`docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`](docs/superpowers/specs/2026-07-12-aeos-architecture-design.md) | Full architecture design |

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
- **Schemas change only with regenerated `schemas/*.json`** — the drift test
  enforces it; never hand-edit generated schemas.
- **Facts are the code.** Docs describe intent; code and git history are the
  facts. On any inconsistency, trust the code, fix the doc, log the drift.

---

## License

TBD — OSS readiness is [`P5.M1`](docs/ROADMAP.md); ADR pending.

---

> AEOS is built by Mirrorfolio. It is pre-alpha. The contracts package is the
> only thing you should treat as real today; everything else is a designed
> and gated intention. Watch the BOARD, not the hype.
