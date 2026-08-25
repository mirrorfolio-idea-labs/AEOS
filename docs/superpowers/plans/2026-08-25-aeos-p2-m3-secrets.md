# AEOS P2.M3 — Secrets Store Implementation Plan

> **For agentic workers:** task-by-task, in order. Full green bar
> (`pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`)
> before every commit; the completing commit flips that ROADMAP checkbox.

**Goal:** secrets live in an encrypted store under `<AEOS_HOME>/secrets/`,
are referenced by name from agent configs, injected into runner env only
when the effective policy allows, and can never leak into transcripts,
events, or audit logs (spec §11).

**Architecture:** a new leaf package `@aeos/secrets` owns storage and
crypto (nothing below it but node builtins + one crypto lib). The daemon's
existing `SecretResolver` seam (`apps/aeosd/src/api-module.ts`) grows a
store-backed branch while keeping `env:` refs working. Injection happens at
the `guardAdapter` profile seam (`packages/api/src/policy-gate.ts`) — the
same defense-in-depth boundary as policy enforcement. Redaction wraps the
event bus publish point so every sink (transcript writer, audit appender,
SSE, approvals inbox) receives scrubbed events by construction.

**Scope decision (Kabeer, 2026-08-25):** age-only v0. The store interface
is keychain-ready, but no native keychain dependency ships tonight;
ROADMAP T1 accept text gets reworded at completion (D2 precedent), logged
in S07 + BOARD drift register as D10.

**New dependencies:** `age-encryption` (pure-TS age v1 format, FiloSottile
blessed) in `packages/secrets` only. Declare in package.json immediately
(S04 lesson).

## Global constraints

- Contracts changes ⇒ `pnpm -F @aeos/contracts gen:schemas` + regenerated
  output committed in the same commit.
- Conventional commits with `[AEOS-P2.M3.T<n>]`; ROADMAP flip in-completion-
  commit; files ≤800 lines; depcruise clean (secrets is a leaf — imports
  nothing from workspace packages).
- Secret values never appear in argv, files outside `<AEOS_HOME>/secrets/`,
  logs, or test fixtures. Test canaries use obvious marker strings
  (`CANARY-<random>`).

---

### Task 1: Age-encrypted secret store with CRUD API  `[AEOS-P2.M3.T1]`

**Files:**
- Create: `packages/secrets/package.json` (+ tsconfig), name `@aeos/secrets`,
  dep `age-encryption`.
- Create: `packages/secrets/src/store.ts`:
  - `interface SecretStore { set(ref,value): Promise<void>; get(ref):
    Promise<string>; delete(ref): Promise<boolean>; list(): Promise<string[]> }`
  - `createFileSecretStore(home, opts?)`: layout `<home>/secrets/`
    (dir 0700), identity X25519 at `<home>/secrets/identity.key` (0600,
    generated on first use via `age-encryption`'s identity helpers), payload
    `<home>/secrets/store.age` = age-encrypted JSON map written atomically
    (tmp+rename, 0600). Every mutation re-encrypts the whole map (v0 scale:
    fine).
  - Typed errors: `SecretNotFoundError`, `SecretStoreLockedError` (missing/
    unusable identity), never string-leak values in messages.
- Create: `packages/secrets/src/index.ts` exporting the above.
- Modify: root `pnpm-workspace.yaml` already globs `packages/*` — just
  `pnpm install`.
- Modify: `apps/aeosd/src/api-module.ts` — `startApiModuleConfig` gains
  optional `secretStore`; the resolver tries `env:` refs first (unchanged),
  otherwise `secretStore.get(ref)`; when absent, behavior is exactly today's
  (golden-path unaffected).
- Tests: `packages/secrets/test/store.test.ts` — round-trip set/get/list/
  delete; second handle on same home reads values; **unreadable-without-key**:
  copying only `store.age` to a fresh home → get throws
  `SecretStoreLockedError`; tampered store.age → typed error; file mode
  assertions (0700 dir, 0600 files); value never present in any other file
  under home.

**Steps:** RED store tests → implement → green package suite → wire aeosd
resolver (optional injection, existing tests untouched) → full green bar →
commit `feat(secrets): age-encrypted secret store CRUD [AEOS-P2.M3.T1]`.

---

### Task 2: Policy-gated env injection into runners  `[AEOS-P2.M3.T2]`

**Files:**
- Contracts: `AgentConfigSchema` gains optional `secrets: z.array(z.string())
  .readonly().optional()` (declared refs, never values); gen:schemas.
- Modify: `packages/api/src/policy-gate.ts` — `guardAdapter(adapter,
  effective, options?)` where `options = { registry?, inject?:
  (agent) => Promise<Record<string,string>> }`. Wrapped `createProfile`:
  after delegating, if `effective.tiers.secrets_access === 'allow'` and the
  agent declares refs, merge `inject(agent)`'s `{ENV_NAME: value}` into
  `profile.env`; any other tier (incl. default posture) injects nothing.
  Env name mapping: `AEOS_SECRET_` + uppercased ref with non-alnum → `_`.
  spawn stays sync — injection rides profile creation.
- Modify: `apps/aeosd/src/api-module.ts` — pass `inject` reading declared
  refs through the resolver (env:/store) when a store is configured.
- Tests: `packages/api/test/injection.test.ts` — fake adapter capturing
  `profile.env`: allow + declared ref → `AEOS_SECRET_FOO` present with
  resolved value; deny → absent; default posture (no tier) → absent;
  undeclared-but-stored ref → absent even under allow (allowlist semantics);
  contracts golden line for the new field.

**Steps:** RED injection tests → implement gate + contracts regen → wire
daemon → green bar → commit `feat(api): policy-gated secret injection
[AEOS-P2.M3.T2]`.

---

### Task 3: Redaction filter on the event pipeline (canary exit gate)  `[AEOS-P2.M3.T3]`

**Files:**
- Create: `packages/kernel/src/bus/redact.ts` — `attachRedaction(bus,
  getValues: () => Iterable<string>)`: returns a wrapped bus whose
  `publish()` deep-clones the event replacing any string occurrence of a
  registered value with `[REDACTED]` before enqueue; subscribers added via
  the wrapper are forwarded. Empty/short (<8 char) values ignored.
- Modify: kernel index export; `apps/aeosd/src/daemon.ts` (or api-module —
  wherever the bus is constructed) wrap the bus once at construction with a
  provider that yields resolved credential values + all store values.
- Tests: `packages/kernel/test/redact.test.ts` — nested-payload scrubbing,
  non-string fields untouched, provider re-queried per publish (live
  registry), short-value ignore.
- Exit-gate e2e: `apps/aeosd/test/canary-leak.e2e.test.ts` — real daemon +
  fake provider whose scripted `item.tool_result` echoes `CANARY-...`
  (planted via store + env credential): assert canary appears NOWHERE —
  not in `sessions/<id>/transcript.ndjson`, not in `audit/*.ndjson`, not in
  the SSE event stream captured via the SDK client, not in ADE-facing REST
  payloads — while a control marker in the same events IS present in each
  sink (proves the sinks were actually exercised).

**Steps:** RED redact tests → implement → RED canary e2e → wire daemon →
full green bar + Playwright smoke unchanged → commit `feat(kernel):
pipeline-wide secret redaction [AEOS-P2.M3.T3]`.

---

## Exit gate (P2.M3)

The canary-leak e2e is the flagship: planted secret, echoed by a tool
result, absent from transcript, audit, SSE, and REST payloads simultaneously
— control markers prove coverage. All three checkboxes `[x]`, T1 accept
text reworded to age-only v0 (D10), R5 drift scan clean, S07 closed, BOARD
synced.
