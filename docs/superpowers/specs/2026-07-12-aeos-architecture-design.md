# AEOS — Autonomous Engineering Operating System: Architecture Design

**Date:** 2026-07-12
**Status:** Draft for review
**Owner:** Kabeer (Mirrorfolio)
**Repo:** `~/Desktop/ADE` (working name; runtime = AEOS, desktop/web UI = ADE)

---

## 1. Thesis

AEOS is an operating system for autonomous software engineering. Agents are
persistent engineers that own identity, memory, repositories, objectives, and
task history. Sessions are disposable execution contexts. The system survives
session limits, context limits, process crashes, and machine restarts, and
resumes interrupted work automatically.

Three principles govern every component:

1. **Files are truth.** All durable state (memory, transcripts, plans,
   checkpoints, policy, audit) lives in human-readable files. Databases and
   vector indexes are derived and rebuildable. The model's context window is a
   cache over file state — never the source of truth.
2. **Contracts over code.** Every module boundary is a versioned, schema-defined
   wire contract (JSON Schema, NDJSON events, OpenAPI). Any module can be
   replaced, extracted to a separate service, or rewritten in another language
   without touching its consumers. The implementation language (TypeScript
   today) is a detail, not a commitment.
3. **The objective is the recovery unit.** Autonomy is structured as durable
   objectives → plans → tasks with a checkpoint after every step. Recovery
   never replays a transcript; it re-enters the plan at the last completed
   checkpoint.

## 2. Locked decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Execution substrate | Wrap agent CLIs (Claude Code, Codex CLI, OpenCode) as hermetic subprocess providers | Inherit mature tool loops; fastest to a working system; adapter keeps it provider-agnostic |
| D2 | Harness hygiene | Each harness runs with a **clean config home by default** (no user plugins/skills/global config); features re-enabled per-agent via explicit toggles | Prevents corruption of agent self-learning by the host machine's customizations |
| D3 | Runtime language | TypeScript/Node — but architecture optimized for **replaceability**, not the language | Ecosystem fit (CLIs, MCP, UI); contracts make the language swappable |
| D4 | UI | Web-first, served by the daemon; thin desktop wrapper (Tauri) | One UI codebase covers desktop and cloud |
| D5 | Memory | Files as truth + derived indexes | Inspectable, diffable, portable, crash-proof |
| D6 | v0.1 slice | One persistent agent, resumable across restarts | Proves the core thesis before multi-agent complexity |
| D7 | Shape | Modular kernel + durable session runners (Shape A) | Replaceable modules in one daemon; sessions survive daemon/UI restarts; extract services only when scale demands |

## 3. Research foundations (what we take from whom)

| Source | Take | Reject |
|--------|------|--------|
| **Superset** (`superset-sh/superset`) | Standalone session-runner daemon owning agent processes over a Unix socket; per-session ring buffers; versioned framed protocol; fd-handoff across daemon upgrades; worktree-per-task layout. Never run node-pty under Bun. | Postgres+ElectricSQL sync as truth; macOS-only Electron coupling |
| **Hermes** (`NousResearch/hermes-agent`) | Hard char-budgeted memory files; overflow = explicit error the agent must resolve (no silent truncation); frozen-snapshot memory injection for prompt-cache stability; background Curator (idle-triggered, ages knowledge, archives, never deletes); FTS + summarization for cross-session recall | Single-memory-provider limitation; two-file-only layout |
| **Conductor** (conductor.build) | "Harness" vocabulary and abstraction; managed harness binaries with BYO fallback; gitignored per-workspace `.context/` scratch; workspace-as-unit-of-review | Auth passthrough as the only mode (conflicts with hermetic isolation — we make it per-agent opt-in); closed source; no headless mode |
| **OpenCode** (`anomalyco/opencode`) | Server-owns-sessions / clients-are-thin; OpenAPI spec → generated SDK pipeline; SSE event bus; config-dir layering with explicit disable flags | Sessions as opaque provider-internal JSON (conflicts with files-as-truth); Effect framework (adopt patterns, not the framework) |
| **Codex CLI** | `thread/turn/item` event taxonomy for lifecycle modeling; sandbox-mode-as-flag; `resume --last` two-stage pipelines | Rollout files as canonical transcript (provider-internal only) |
| **Claude Code** | `stream-json` NDJSON events; `total_cost_usd` per invocation; `CLAUDE_CONFIG_DIR` + `--bare` + granular `CLAUDE_CODE_DISABLE_*` for hermetic profiles | — |
| **OpenRouter** | `/models` pricing/context metadata as a local routing index; OpenAI-compatible fallback routing | — |
| **vibe-kanban / gpt-pilot / Aider / SWE-agent / AutoGPT** | Durable object = the task, not the chat; checkpoint-after-every-step; architect/editor two-model cost split; ACI design matters more than model choice; free-running loops need externally imposed structure (budgets, gates) | — |

**Differentiators no existing tool has:** (a) headless JSON-streaming as the
default execution mode with PTY attach as a human-takeover escape hatch;
(b) daemon-enforced per-agent/per-objective budget caps; (c) hermetic harness
profiles by default.

## 4. System overview

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
│  │           inside sandbox, in agent's git worktree     │ │
│  └───────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

- **Kernel daemon (`aeosd`)** owns identity, registry, policy, scheduling,
  memory, routing, and the API. It is restartable at any time.
- **Session runners** are separate OS processes owned by a tiny supervisor.
  A runner survives daemon restarts (Superset's pattern); on reconnect the
  daemon re-adopts running sessions by durable session ID. Runners hold the
  harness subprocess and stream normalized events back.
- **Clients are thin.** The web UI, desktop wrapper, and CLI all speak the
  same OpenAPI + SSE surface. Nothing in the UI holds state the daemon
  doesn't.

### Data flow (one autonomous step)

```
Objective (file) → Planner emits/updates Plan (file) → Scheduler picks Task
→ Policy engine gates the task's permission tier & budget
→ Model router picks provider+model for the task class
→ Runner spawns harness in hermetic profile + sandboxed worktree
→ Harness NDJSON events → normalized AEOS events → event bus
   → transcript file (append-only NDJSON)   → SSE to clients
   → cost meter (budget enforcement)        → audit log
→ Task completes → checkpoint written → memory writes proposed
→ Scheduler advances plan (or Planner revises) → next task
```

## 5. Repository structure (pnpm monorepo)

```
aeos/
├── packages/
│   ├── contracts/        # Zod schemas → exported JSON Schemas; event
│   │                     # envelope; protocol versions. THE dependency root.
│   ├── kernel/           # registry, event bus, state store, lifecycle
│   ├── policy/           # permission tiers, budget caps, audit
│   ├── memory/           # file memory + derived indexes + curator
│   ├── scheduler/        # durable queues, wakeups, resume-on-boot
│   ├── planner/          # objective → plan → tasks; plan revision
│   ├── router/           # cost/quality model routing (pricing index)
│   ├── runner/           # session-runner process + supervisor + protocol
│   ├── providers/
│   │   ├── provider-core/    # HarnessAdapter interface + conformance tests
│   │   ├── provider-claude/  # Claude Code adapter
│   │   ├── provider-codex/   # Codex CLI adapter
│   │   └── provider-opencode/# OpenCode adapter
│   ├── api/              # Fastify server, OpenAPI spec, SSE
│   └── sdk/              # generated TS client (from OpenAPI)
├── apps/
│   ├── aeosd/            # daemon assembly (composition root)
│   ├── ade/              # web UI (React + xterm.js)
│   ├── desktop/          # Tauri wrapper around ade
│   └── cli/              # aeos CLI (thin SDK client)
├── docs/
│   ├── superpowers/specs/    # design docs (this file)
│   ├── superpowers/plans/    # implementation plans
│   ├── adr/                  # architecture decision records
│   └── ROADMAP.md            # phase/milestone/task index (drift anchor)
└── deploy/               # docker-compose, systemd units, Helm (later)
```

Rule: `contracts` depends on nothing; everything depends on `contracts`;
packages never import each other's internals — only contracts and published
package entry points. CI enforces this with dependency-cruiser.

## 6. Kernel and module contracts

- **Event envelope** (every event in the system):
  `{ v, id, ts, source, agentId?, sessionId?, taskId?, type, payload }` —
  versioned, ULID ids, append-only. One schema in `contracts`.
- **Event bus:** in-process pub/sub in v0; the contract is the envelope, so a
  NATS/Redis transport can replace it without consumer changes.
- **State store:** authoritative state = files (below). SQLite
  (`~/.aeos/index.db`) holds derived indexes only: session index, task queue
  materialization, FTS over memory/transcripts, pricing cache. Deleting it is
  always safe; `aeos reindex` rebuilds from files.
- **Module lifecycle:** each module exports `init(deps) → { start, stop, health }`.
  The composition root (`apps/aeosd`) wires modules; nothing self-registers
  globally.

## 7. Domain model

```
Workspace (category: Mirrorfolio, Research, Hardware, …)
 └── Agent (persistent engineer)
      ├── identity + profile + avatar
      ├── harness config (provider, model prefs, feature toggles)
      ├── repository bindings (one or more repos + worktrees)
      ├── memory/ (files)
      ├── objectives/ (durable goals)
      │    └── plans/ → tasks (checkpointed)
      └── sessions (ephemeral execution contexts)
           └── transcript.ndjson, cost ledger, runner state
```

On-disk layout (all under `AEOS_HOME`, default `~/.aeos/`):

```
~/.aeos/
├── aeos.yaml                     # daemon config
├── index.db                      # derived (rebuildable)
├── audit/audit-YYYY-MM-DD.ndjson # append-only audit log
└── workspaces/<workspace>/
    └── agents/<agent>/
        ├── agent.yaml            # identity, harness, policy refs, model prefs
        ├── memory/               # §8
        ├── objectives/<obj-id>/
        │   ├── objective.md      # goal, constraints, definition of done
        │   ├── plan.md           # current plan w/ task checklist + status markers
        │   └── checkpoints/<task-id>.yaml
        ├── harness/
        │   ├── claude/           # CLAUDE_CONFIG_DIR for this agent
        │   ├── codex/            # CODEX_HOME for this agent
        │   └── opencode/         # XDG_* homes for this agent
        ├── worktrees/<repo>/<branch>/
        └── sessions/<session-id>/
            ├── session.yaml      # state machine, runner pid, provider ids
            ├── transcript.ndjson # canonical normalized event log
            └── costs.ndjson
```

Agent config is git-versioned per agent (the agent dir is itself a git repo),
so an agent's entire mind and history can be backed up, moved between
machines, or inspected with standard tools. **This is also the portability
story:** copy the directory, run `aeos reindex`, the agent lives elsewhere.

**Sessions** are a state machine:
`created → starting → running → (waiting_approval | paused) → completed | failed | orphaned`.
Session IDs are AEOS ULIDs owned by the daemon; provider session ids
(Claude's `session_id`, Codex thread ids) are stored as foreign references in
`session.yaml`. Cross-session result routing always keys on the AEOS id —
this is where prior art breaks (Hermes #57576), so it's a contract-level rule.

## 8. Memory system

Structure (per agent, files as truth):

```
memory/
├── MEMORY.md           # index: one line per memory file (hook + path)
├── identity/           # who the agent is; stable across everything
├── preferences/        # learned developer patterns (self-learning target)
├── architecture/  decisions/  lessons/  mistakes/
├── roadmap/  experiments/  research/  knowledge/  skills/
├── meeting-notes/  documentation/  todos/
└── .archive/           # curator moves stale items here; never deletes
```

Rules (Hermes-derived, hardened):

1. **Budgets.** Each directory has a char budget declared in `MEMORY.md`
   frontmatter. Writes that exceed budget return an **error**; the agent must
   consolidate or archive in the same turn. No silent truncation, ever.
2. **Frozen injection.** At session start, the daemon composes the memory
   snapshot (index + files selected by relevance) and passes it to the
   adapter, which injects it through an explicit channel — Claude Code:
   system-prompt append / a generated context file explicitly re-enabled via
   `--settings` (baseline `--bare` stays on); Codex/OpenCode: generated
   AGENTS.md inside the hermetic home. The snapshot is frozen for the
   session — preserving prompt-cache stability. Mid-session learning goes
   through a `memory.propose` tool call; proposals are applied by the daemon
   (policy-gated) and take effect next session.
3. **Derived indexes.** FTS5 + embeddings over memory and transcripts, stored
   in `index.db`. Retrieval API: `memory.search(query, k)` exposed to agents
   as a tool. Indexes rebuildable from files.
4. **Curator.** A scheduled background job (idle-triggered) that summarizes,
   deduplicates, ages (active → stale → archived), and reorganizes memory —
   running as a cheap-model session with a dry-run mode and its own audit
   trail. Archives, never deletes.
5. **Self-learning loop.** Post-task retrospective step writes `lessons/` and
   `preferences/` proposals from diffs between plan and actuals (what the
   developer corrected, what failed, what was re-done). This is how "learns
   your patterns and implements them" becomes concrete: preferences feed the
   frozen snapshot of every future session.

## 9. Provider layer (harness adapters)

One interface in `provider-core`:

```ts
interface HarnessAdapter {
  id: 'claude-code' | 'codex' | 'opencode' | string
  capabilities(): CapabilityMatrix          // resume, structuredOutput, mcp, sandbox, costReporting…
  createProfile(agent: AgentConfig): Promise<HarnessProfile>  // hermetic home dir
  spawn(opts: {
    profile: HarnessProfile; workdir: string;
    prompt?: string; resumeToken?: string;
    permissionPolicy: CompiledPolicy; mcpServers?: McpRef[];
  }): SessionHandle                         // events: AsyncIterable<AeosEvent>
  translate(raw: unknown): AeosEvent[]      // provider NDJSON → canonical events
}
```

- **Canonical event schema** normalizes Claude's `stream-json`, Codex's
  `thread/turn/item`, and OpenCode's SSE into one taxonomy:
  `session.*, turn.*, item.(message|tool_call|tool_result|file_change), cost.usage, approval.request`.
- **Hermetic profiles** (D2): Claude → `CLAUDE_CONFIG_DIR=<agent>/harness/claude`
  + `--bare`, features re-enabled via `--settings/--mcp-config/--plugin-dir`
  and `CLAUDE_CODE_DISABLE_*` toggles; Codex → `CODEX_HOME=<agent>/harness/codex`
  + generated `config.toml`; OpenCode → per-agent `XDG_{CONFIG,DATA,STATE}_HOME`
  + `OPENCODE_DISABLE_PROJECT_CONFIG=1`, or `opencode serve` per agent.
  Each toggleable feature (plugins, skills, MCP servers, memory files) is an
  explicit entry in `agent.yaml` — off by default.
- **Managed binaries:** AEOS pins and manages harness versions per agent
  (Conductor pattern) with BYO-binary fallback. Auth is per-agent: API key
  from the daemon's secret store, or explicit opt-in passthrough of the
  user's CLI login.
- **Credential profiles and BYOK switching.** Every agent references a
  `credentialProfile` in `agent.yaml`; profiles live in the daemon secret
  store and come in three kinds:
  - `subscription` — explicit opt-in passthrough of the user's harness login;
  - `api-key` — BYOK vendor key (e.g. `ANTHROPIC_API_KEY`, which overrides
    subscription auth in Claude Code headless mode) at full native
    performance;
  - `gateway` — `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` (or provider
    equivalent) pointed at OpenRouter/any compatible proxy, so **any model**
    runs through Claude Code unchanged, with optional `ANTHROPIC_MODEL`
    override.
  Switching is a first-class API/UI toggle ("on-the-go"): the scheduler
  checkpoints the active task, the next session spawns with the new profile,
  and the plan resumes — no state lost, because sessions are disposable by
  design. A policy-gated **auto-failover** rule lets the daemon switch
  profile automatically on `usage_limit`/rate-limit events so objectives keep
  running beyond subscription session/usage limits. Realized costs are
  metered per profile so budgets (§11) hold across switches.
- **Execution modes:** default headless (JSON streaming). PTY attach is an
  optional runner capability for human takeover — the runner allocates a PTY
  and bridges it to the UI terminal tab (xterm.js) while continuing to parse
  the event stream.
- **Direct-API providers** (OpenRouter, Ollama, Anthropic/OpenAI SDKs) are a
  second adapter family implementing the same interface with a minimal native
  loop — explicitly post-v1, enabled by the contract, not built now.

## 10. Execution engine and sandboxing

- **Isolation unit:** one git worktree per (agent, repo, objective). Agents
  never work on a user's live checkout. Commits happen on agent branches;
  merge/PR is a policy-gated action.
- **Sandbox tiers** (per agent, per action class):
  - `none` — trusted local mode (v0.1 default, still worktree-scoped, policy-gated)
  - `container` — runner + harness inside a per-project Docker container with
    mounted worktree (the "separate sandboxes per project" requirement)
  - harness-native sandboxes (Codex `--sandbox`, Claude permission modes) are
    composed *inside* whichever tier is active.
- **Runner protocol:** length-prefixed framed messages over Unix socket
  (versioned). Runner responsibilities: spawn/supervise harness process,
  stream events, enforce hard timeouts, heartbeat, write transcript locally
  (so a daemon crash loses nothing), expose PTY attach.
- **Crash matrix:**
  | Failure | Recovery |
  |---|---|
  | Daemon crash/upgrade | Runners keep running; daemon re-adopts by session ID on boot |
  | Runner crash | Supervisor restarts; scheduler resumes task from last checkpoint via provider resume (`--resume`, `exec resume`) or plan re-entry |
  | Machine reboot | `aeosd` on boot: scan `sessions/*/session.yaml`, mark orphans, scheduler re-enters plans at last checkpoint |
  | Provider session corrupt | Transcript + checkpoints are AEOS-owned; start a fresh provider session, re-inject context from files |

## 11. Security and policy engine

- **Permission tiers** (per action, compiled per agent+objective):
  `read_files, write_files, execute_commands, install_packages, git_commit,
  git_push, deploy, secrets_access, network_access` — each mapped to
  `allow | confirm | deny`. Policies are YAML files (workspace defaults →
  agent overrides → objective overrides; most-specific wins), compiled into
  harness-native flags (`--allowedTools`, `approval_policy`, sandbox mode)
  *and* enforced daemon-side at the API/runner boundary (defense in depth —
  never trust the harness's enforcement alone).
- **Approval flow:** `confirm`-tier actions emit `approval.request` events;
  the session enters `waiting_approval`; UI/CLI/push-notification answers.
  Timeouts configurable (deny-by-default on expiry).
- **Budgets:** per-agent and per-objective caps (USD and token), metered from
  provider cost events; hard-stop at cap with a checkpoint, notify, and a
  `resume-with-increase` path. This is daemon-enforced — a runaway loop
  cannot outspend its cap.
- **Audit:** every action (tool call, approval, policy decision, memory
  write, spend) appends to `audit/*.ndjsonl`. Append-only, greppable.
- **Secrets:** OS keychain via keytar-equivalent where available, else
  age-encrypted file store; secrets are injected into runner env per policy,
  never written into worktrees, profiles, or transcripts (redaction filter on
  the event pipeline).
- **Default posture:** least privilege; new agents start read-only +
  worktree-write + confirm-everything-else.

## 12. Scheduler and planner (the autonomy loop)

- **Objectives** are durable files (goal, constraints, definition of done,
  budget, policy overrides). **Plans** are markdown checklists with stable
  task IDs and status markers — human-editable, agent-maintained.
- **Loop:** `objective → plan → [task → execute → verify → checkpoint]* → review → integrate → observe/continue`.
  The planner is itself a model call (routed to a frontier model); execution
  tasks route per §13. Verification (tests, lint, build) is a first-class
  task type, not an afterthought.
- **Checkpoints** after every task: `{taskId, status, commit?, providerResumeToken?, summary, costs}`.
  Recovery = re-enter plan at first non-completed task; the checkpoint
  summary + memory snapshot rebuilds context. Transcripts are never replayed.
- **Scheduler** owns: durable task queues (materialized in SQLite from plan
  files), concurrency limits per agent/machine, wakeups (cron-like +
  idle-triggered jobs like the curator), backoff on repeated task failure
  (3 strikes → task marked `blocked`, objective paused, human notified —
  the AutoGPT lesson: loops need externally imposed stopping rules).
- **Delegation (post-v0.1):** a task may specify a different agent or a
  spawned specialist sub-session; coordination happens through the plan file
  and git, not through shared context.

## 13. Cost-aware model routing

- `router` maintains a pricing/capability index (OpenRouter `/models` +
  static tables for subscription harnesses) refreshed daily.
- Every task carries a **task class** (`plan, architect, implement, refactor,
  review, security_review, summarize, docs, rename`) set by the planner.
  Routing policy maps class → (provider, model, thinking budget) with
  per-workspace overrides. Defaults follow the Aider architect/editor split:
  frontier models plan and review; cheaper models implement and summarize;
  local models (post-v1) handle mechanical transforms.
- Router decisions and realized costs are logged per task, so routing policy
  is auditable and tunable from data.

## 14. API layer and UI

- **API:** Fastify + `@fastify/swagger` → OpenAPI 3.1 spec → generated TS SDK
  (`packages/sdk`). Resources: workspaces, agents, objectives, plans, tasks,
  sessions, memory, approvals, policies, events. Consistent envelope
  (`success/data/error/meta`) per your API standards. Auth: none on loopback
  by default; token auth the moment it binds beyond localhost; multi-user
  RBAC is post-v1 but the token layer is designed for it.
- **Events:** one SSE stream (`/v1/events?filter=…`) carrying canonical
  envelope events; the UI is a pure consumer. WebSocket only for PTY attach.
- **ADE UI** (matches your mockup): left sidebar = workspaces (categories)
  with agent avatars; main pane = per-agent view with tabs (sessions/
  terminals), agent conversation, "access agent files" (memory/objectives/
  worktree browser), approvals inbox, cost meters. React + Vite + xterm.js.
  Desktop = Tauri wrapping the served UI with deep-link/notification niceties.
- **Chat-to-create-agent:** agent creation is a conversation with a built-in
  "onboarding" flow that writes `agent.yaml` + identity memory — no forms
  required, forms available.

## 15. Plugin system

- **Plugin = npm package with a manifest** declaring: contributes
  (`provider | memory-backend | planner | scheduler-job | policy | ui-panel |
  deploy-target`), contract version, and entry point. Loaded by the
  composition root; UI panels are federated modules served by the daemon.
- Community can add providers/models/planners/policies/UI/deploy targets
  without touching core — the same `contracts` package is the plugin ABI.
  Conformance test suites (`provider-core` ships one) keep third-party
  adapters honest.
- Core plugins (claude/codex/opencode providers, file memory, local
  scheduler) live in-repo and use the same mechanism — the plugin system is
  exercised from day one, not bolted on.

## 16. Deployment strategy

| Target | Shape |
|---|---|
| Laptop/workstation | `aeosd` as user service (systemd user unit / launchd), UI at `localhost`, Tauri app optional |
| Home server | same daemon + token auth + TLS (reverse proxy), web UI remote |
| Docker | `docker compose up`: aeosd + volume for `AEOS_HOME`; per-project sandbox containers as siblings via mounted docker socket (or rootless nested) |
| Kubernetes (post-v1) | kernel as Deployment, runners as Jobs/Pods (runner protocol already TCP-capable), `AEOS_HOME` on PVC, contracts unchanged |

Same code, same contracts, different process placement. Nothing in v0.1 may
assume single-machine (no absolute paths in contracts, no PID-based identity,
socket transport abstracted).

## 17. Failure modes and design challenges (pre-mortem)

1. **Context compression is where long-running agents break** (evidence:
   Hermes's bug tracker). Mitigation: we never depend on in-context
   continuity — checkpoint/plan re-entry + frozen memory snapshots. Sessions
   are *expected* to be short-lived; longevity lives in files.
2. **Harness churn.** CLIs change flags/event formats under us. Mitigation:
   pinned managed binaries per agent; adapter conformance tests run in CI
   against pinned versions; capability matrix gates features per version.
3. **Runner/daemon protocol drift.** Versioned framed protocol with
   min/max-supported handshake; daemon can adopt older runners.
4. **Memory rot and bloat.** Budgets + curator + archive-never-delete;
   retrieval is ranked, not exhaustive.
5. **Runaway autonomy/cost.** Daemon-enforced budget caps, 3-strike task
   backoff, deny-by-default approval expiry, kill switch (`aeos stop --all`,
   plus a `STOP` file check honored by runners even if the daemon is dead).
6. **Cross-platform PTY/process pain** (Windows). v0.x targets Linux/macOS;
   Windows via WSL2 documented; native Windows is a milestone, not an
   assumption baked into the runner.
7. **SQLite contention under many sessions.** It's derived data — WAL mode,
   and if it ever bottlenecks, swap for Postgres behind the state-store
   contract without touching truth files.
8. **Scope gravity.** The roadmap (§19) is single-spine: nothing in phase N+1
   starts until phase N's exit criteria pass. The plan format itself (stable
   task IDs + acceptance criteria) is the anti-drift mechanism.

## 18. Testing strategy

- **Contracts:** schema round-trip + golden-file tests for every event type
  (provider fixture NDJSON → canonical events). Fixtures recorded from real
  harness runs, replayed in CI — no live API calls needed for the test suite.
- **Unit:** per package, Vitest, 80%+ on core logic (policy compiler, plan
  parser, budget meter, checkpoint recovery).
- **Integration:** daemon+runner lifecycle tests with a `provider-fake`
  (scripted harness emitting canonical fixtures) — crash/restart/re-adopt
  scenarios are the flagship tests, run in CI on every commit.
- **E2E:** Playwright against the web UI + real Claude Code in hermetic
  profile (nightly, budget-capped) covering the v0.1 golden path: create
  agent → give objective → work → kill daemon → restart → verify resume.

## 19. Build decomposition (drift-resistant)

Task ID scheme: `AEOS-P<phase>.M<milestone>.T<task>` — stable forever, used
in commits (`feat(runner): frame protocol [AEOS-P1.M2.T3]`), plans, and
`docs/ROADMAP.md`. Every milestone gets its own plan doc in
`docs/superpowers/plans/` written so a **cold-start agent with zero
conversation history** can execute it: context brief, exact file paths,
acceptance criteria, verification commands. Model-agnostic by construction.

- **P1 — Spine (v0.1, D6):** contracts; kernel+state; runner+supervisor;
  Claude Code adapter (hermetic); file memory (manual curation);
  minimal objective/plan/checkpoint loop for one agent; API+SSE; minimal ADE
  (sidebar, one agent, terminal tab, conversation, file browser); crash
  recovery e2e. Exit: the kill-daemon-and-resume demo passes.
- **P2 — Safety + polish:** policy engine full tiers + approvals inbox;
  budgets; audit; secrets; curator; session PTY attach; Codex + OpenCode
  adapters; managed binaries.
- **P3 — Autonomy:** planner task classes; model router; verification tasks;
  retrospective/self-learning loop; scheduler wakeups; delegation.
- **P4 — Scale + community:** Docker sandbox tier; plugin loader public API +
  docs; deploy targets; multi-machine runner transport; K8s.

## 20. Open questions (tracked, not blocking)

1. Live-collab conflict policy when a human edits the same worktree as the agent (P2).
2. Direct-API native loop priority (post-v1, contract already allows it).
3. Multi-user auth/RBAC model for team servers (post-v1).
4. Windows-native runner (post-v1).

---

*Next artifact: `docs/superpowers/plans/2026-07-12-aeos-p1-spine-plan.md` (after spec approval).*
