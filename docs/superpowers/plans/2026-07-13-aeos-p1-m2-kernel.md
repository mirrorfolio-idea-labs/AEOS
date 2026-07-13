# AEOS P1.M2 — Kernel: State Store, Registry, Event Bus — Implementation Plan

> **Cold-start brief.** You are implementing milestone M2 of the AEOS build
> (`docs/ROADMAP.md`, spec `docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`
> §4–§7). M1 is complete: `packages/contracts` (Zod schemas, event envelope,
> domain objects, event taxonomy, JSON Schema export) is on `main` with CI
> (`.github/workflows/ci.yml`) and dependency-cruiser boundaries. M2 builds the
> kernel package and the daemon skeleton: **files are truth, SQLite is a
> derived index, everything is rebuildable.** Work on branch
> `feat/aeos-p1-m2-kernel` from `main`.

## Global constraints

- Node 22 (`.nvmrc`), pnpm 9, ESM, strict TS. Copy the `packages/contracts`
  config pattern exactly: `tsconfig.json` (build, `include:["src"]`,
  `rootDir/outDir`) + `tsconfig.test.json` (`noEmit`, includes `src`,`test`)
  + scripts `build` / `typecheck` (points at tsconfig.test.json) / `test`.
- New package `packages/kernel` (`@aeos/kernel`) and new app `apps/aeosd`
  (`@aeos/aeosd`). Both may depend on `@aeos/contracts` **by package name
  only** — `pnpm depcruise` must stay green; `contracts` itself must not gain
  dependencies.
- External deps (battle-tested over hand-rolled): `yaml` (^2) for YAML,
  `better-sqlite3` (^11) + `@types/better-sqlite3` for the derived index
  (synchronous, WAL — spec §17.7). Nothing else without a reason recorded in
  the commit message.
- Every commit: conventional format ending `[AEOS-P1.M2.Tn]`; the commit that
  completes a task flips its checkbox in `docs/ROADMAP.md` (PM rule R1,
  `docs/pm/README.md`). TDD: write the failing test first in every step.
- **Contract-level rule (spec §7):** all cross-session routing keys on AEOS
  ULIDs; provider ids are foreign references only. Nothing in this milestone
  may assume single-machine (no absolute paths persisted inside files, no
  PID-based identity — pids are runtime metadata in `session.yaml` only).
- `AEOS_HOME` default is `~/.aeos` but **every module takes it as an explicit
  constructor argument**; tests use `fs.mkdtemp` sandboxes, never the real
  home.

## On-disk layout being built (spec §7, authoritative)

```
$AEOS_HOME/
├── aeos.yaml                          # daemon config (minimal in M2)
├── index.db                           # DERIVED — deleting it is always safe
├── audit/                             # created empty (used from P2.M2)
└── workspaces/<ws>/agents/<agent>/
    ├── agent.yaml                     # AgentConfig (contracts schema)
    ├── memory/  objectives/  harness/  worktrees/     # created empty dirs
    └── sessions/<session-ulid>/
        ├── session.yaml               # SessionRecord (contracts schema)
        ├── transcript.ndjson          # canonical event log (append-only)
        └── costs.ndjson
```

---

### Task 1: `AEOS_HOME` layout + atomic writes + YAML codecs  `[AEOS-P1.M2.T1]`

**Files:**
- Create: `packages/kernel/package.json`, `tsconfig.json`, `tsconfig.test.json`,
  `src/index.ts`, `src/home/paths.ts`, `src/home/atomic.ts`, `src/home/codecs.ts`,
  `test/atomic.test.ts`, `test/codecs.test.ts`
- Modify: `docs/ROADMAP.md` (T1 checkbox, final step of every task)

**Steps (RED → GREEN each):**
1. Package scaffold; smoke test (`expect(true)`) proves the harness runs via
   root `pnpm test` (vitest workspace picks up `packages/*` automatically —
   verify, else extend `vitest.workspace.ts`).
2. `paths.ts`: pure functions from `(home, ids…)` → typed absolute paths
   (`agentDir`, `agentYaml`, `sessionDir`, `sessionYaml`, `transcriptPath`,
   `costsPath`, `indexDbPath`, `auditDir`). `ensureAgentLayout(home, ws, agent)`
   creates the empty dir skeleton. Test: layout matches the tree above exactly
   (snapshot of `readdirSync` recursive).
3. `atomic.ts`: `writeFileAtomic(path, data)` — write to `path + '.tmp.' + random`
   **in the same directory**, `fsync` the fd, `rename`, then `fsync` the parent
   dir fd (crash-safe on POSIX). Readers must ignore `*.tmp.*` files.
4. **Crash-simulation test (exit-gate half #1):** monkey-patch/inject the
   rename step to throw mid-write (simulates `kill -9` between tmp write and
   rename). Assert: original file (when it existed) is byte-identical and
   parseable; the orphan tmp file is detectable and cleaned by
   `cleanTmpFiles(dir)`; a fresh read never sees partial content. Run the
   write→crash→read cycle 100× in a loop with random payload sizes.
5. `codecs.ts`: `readAgentYaml`/`writeAgentYaml`, `readSessionYaml`/
   `writeSessionYaml` — `yaml` parse/stringify + **Zod validation with the
   contracts schemas on both read and write** (corrupt/hand-edited files fail
   loud with a typed `CodecError` naming the path). Round-trip property test:
   parse(stringify(x)) deep-equals x for fixture AgentConfig/SessionRecord.

*Accept (ROADMAP): crash-simulating test (kill between tmp write and rename) never leaves corrupt state.*
Commit: `feat(kernel): AEOS_HOME layout, atomic writes, YAML codecs [AEOS-P1.M2.T1]`

### Task 2: SQLite derived index + `reindex()`  `[AEOS-P1.M2.T2]`

**Files:**
- Create: `src/index-db/db.ts`, `src/index-db/schema.ts`, `src/index-db/reindex.ts`,
  `test/reindex.test.ts`

**Steps:**
1. `db.ts`: open `index.db` with WAL mode, busy_timeout, schema version pragma
   (`user_version`); mismatched version ⇒ drop + rebuild (it's derived data).
2. `schema.ts`: tables `agents(ws, id, name, updated_at)`,
   `sessions(id, agent_id, state, provider_session_id, updated_at)` — exactly
   what M3/M6 need to query without directory walks; nothing speculative.
3. `reindex.ts`: `reindex(home, db)` — full rebuild: walk
   `workspaces/*/agents/*` and `sessions/*`, parse via T1 codecs (skipping and
   collecting corrupt entries into a returned report, never throwing on one
   bad file), repopulate inside a single transaction.
4. Incremental upserts: `indexAgent(...)`, `indexSession(...)` called by the
   registry (T3) and session lifecycle (M3).
5. **Rebuild-equivalence test (exit-gate half #2):** create fixture state
   (2 workspaces, 3 agents, 4 sessions) through public APIs → snapshot all
   queries → close + delete `index.db` → `reindex()` → identical query
   results. Plus: corrupt one `session.yaml` by hand → reindex reports it and
   indexes the rest.

*Accept (ROADMAP): delete `index.db` → `reindex()` → identical query results test.*
Commit: `feat(kernel): SQLite derived index + full reindex [AEOS-P1.M2.T2]`

### Task 3: Registry — workspace/agent CRUD  `[AEOS-P1.M2.T3]`

**Files:**
- Create: `src/registry/registry.ts`, `src/registry/git.ts`, `test/registry.test.ts`

**Steps:**
1. `git.ts`: minimal wrapper over `child_process.execFile('git', …)` —
   `initRepo(dir)`, `commitAll(dir, message)`. No shelling through a string.
2. `registry.ts`: `createWorkspace`, `getWorkspace`, `listWorkspaces`,
   `createAgent`, `getAgent`, `updateAgent`, `listAgents(ws)` — files are
   truth (T1 codecs + atomic writes), index updated via T2 upserts in the same
   call. **Immutable API:** update takes and returns new objects.
3. Agent dir lifecycle (spec §7 portability): `createAgent` builds the layout,
   writes `agent.yaml`, `git init`s the agent dir, commits
   `chore: agent created`. Every `updateAgent` commits `agent.yaml` with a
   message naming the changed keys.
4. Tests: create/read/update round-trips (file content = returned object =
   indexed row); `git log` in the agent dir shows one commit per mutation;
   deleting `index.db` then `reindex()` restores identical `listAgents` output
   (ties T2 to T3).

*Accept (ROADMAP): create/read/update round-trips; git history shows agent.yaml commits.*
Commit: `feat(kernel): workspace/agent registry over files + per-agent git history [AEOS-P1.M2.T3]`

### Task 4: Event bus + transcript appender  `[AEOS-P1.M2.T4]`

**Files:**
- Create: `src/bus/bus.ts`, `src/bus/transcript.ts`, `test/bus.test.ts`

**Steps:**
1. `bus.ts`: in-process typed pub/sub over `AeosEvent` (contracts taxonomy).
   API: `publish(event)`, `subscribe(filter, handler)` → unsubscribe fn.
   Filters: by `type` prefix (`'session.'`), `agentId`, `sessionId`. Delivery
   is in publish order per subscriber (queue, not recursion); a throwing
   handler must not break other subscribers (error captured, surfaced via a
   `bus.error` diagnostic event — never silently swallowed).
2. `transcript.ts`: subscriber that appends every event carrying a
   `sessionId` to that session's `transcript.ndjson` (one JSON line, `\n`,
   append-only fd; serialized writes per session so order is stable).
3. Tests: publish a scripted fake-session event sequence (reuse
   `packages/contracts/test/fixtures/events.golden.ndjson` shapes) →
   transcript lines parse via `AeosEventSchema` and are in publish order;
   two interleaved sessions produce two correctly separated transcripts;
   a subscriber that throws doesn't lose events for others.

*Accept (ROADMAP): events published during a fake session appear in order in `transcript.ndjson`.*
Commit: `feat(kernel): typed event bus + append-only transcript writer [AEOS-P1.M2.T4]`

### Task 5: Module lifecycle + `apps/aeosd` composition root  `[AEOS-P1.M2.T5]`

**Files:**
- Create: `src/lifecycle.ts`, `test/lifecycle.test.ts`,
  `apps/aeosd/package.json`, `apps/aeosd/tsconfig.json`, `apps/aeosd/tsconfig.test.json`,
  `apps/aeosd/src/main.ts`, `apps/aeosd/src/daemon.ts`, `apps/aeosd/test/daemon.test.ts`

**Steps:**
1. `lifecycle.ts` (spec §6): `interface Module { name: string; start(): Promise<void>; stop(): Promise<void>; health(): Promise<Health> }`
   + `createModule(deps)`-style factories; `Kernel` orchestrator that starts
   modules in dependency order, stops in reverse, aggregates `health()`.
   Nothing self-registers globally.
2. `apps/aeosd`: composition root wiring home paths → index db → registry →
   bus → transcript appender as modules. `daemon.ts` exports
   `createDaemon(config)` (testable, no process globals); `main.ts` is the
   thin executable: load `aeos.yaml` (create default on first boot), start,
   handle SIGINT/SIGTERM with graceful stop, exit non-zero on failed boot.
   Also wire subcommand `aeosd reindex` → T2 `reindex()` (the `aeos` CLI
   proper arrives in M7).
3. Tests: boot in a temp home → `health()` all-ok self-check → clean
   shutdown (all module `stop()`s ran, no open handles — vitest will hang
   otherwise, which is itself the regression signal). Failed-boot test: point
   at an unwritable home → boot rejects, daemon exits non-zero.
4. Run the full CI chain
   (`pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`)
   — depcruise now proves `apps/aeosd → @aeos/kernel → @aeos/contracts` uses
   published entry points only.

*Accept (ROADMAP): daemon boots, health endpoint-less self-check passes, clean shutdown test.*
Commit: `feat(aeosd): module lifecycle harness + daemon composition root [AEOS-P1.M2.T5]`

---

## Milestone exit gate (ROADMAP M2)

> kill-daemon-mid-write test leaves recoverable state; reindex test green.

Both live in CI after this milestone: T1 step 4 (crash simulation ×100) and
T2 step 5 (delete-db rebuild equivalence). At exit: flip M2 `[x]` in
`docs/ROADMAP.md`, run the PM drift scan (R5, `docs/pm/README.md`), close the
sprint per `docs/pm/sprints/`, and only then may the M3 plan be written.
