# AEOS P1.M4 — Claude Code Provider (hermetic + BYOK) — Implementation Plan

> **Cold-start brief.** Milestone M4 of the AEOS build (`docs/ROADMAP.md`;
> spec §9). M1 (contracts), M2 (kernel), M3 (runner/supervisor — runner is the
> Unix-socket server; daemon re-adopts by session ULID) are complete. M4 adds
> the provider layer: a `HarnessAdapter` contract with a conformance suite,
> a provider-fake for CI, and the Claude Code adapter that spawns a hermetic
> `claude -p --output-format stream-json --verbose` and translates its NDJSON
> into the canonical taxonomy. Work on branch `feat/aeos-p1-m4-claude-provider`
> from `main`. **No live API calls in the test suite** — recorded fixtures
> only; one optional live smoke test behind `AEOS_LIVE_SMOKE=1`.

## Global constraints

- **Package placement (decision):** flat `packages/provider-core` and
  `packages/provider-claude` — NOT the spec §5 visual tree's
  `packages/providers/<name>` nesting, because the pnpm workspace glob
  (`packages/*`) and the depcruise boundary regex both assume one level.
  Update the spec §5 tree in the exit-gate commit and log the drift (R4).
- `provider-core` may depend on `@aeos/contracts` only. `provider-claude`
  may depend on `@aeos/contracts` + `@aeos/provider-core` published entry
  points. Copy the `packages/runner` scaffolding (tsconfig pair, Vitest).
- Credential material never lands in profiles, transcripts, or fixtures —
  fixture recordings must be scrubbed (assert no `sk-` substrings in a test).
- TDD per step; commits end `[AEOS-P1.M4.Tn]`; ROADMAP checkbox flips in the
  completing commit (PM rule R1).

### Task 1: HarnessAdapter interface + capability matrix + conformance suite  `[AEOS-P1.M4.T1]`

**Files:** `packages/provider-core/` scaffold; `src/adapter.ts`,
`src/conformance.ts`, `src/provider-fake.ts`, `test/provider-fake.test.ts`

1. `adapter.ts`: the spec §9 interface — `id`, `capabilities():
   CapabilityMatrix` (`resume, structuredOutput, mcp, sandbox, costReporting`
   booleans + `maxContextTokens?`), `createProfile(agent: AgentConfig):
   Promise<HarnessProfile>` (`{ rootDir, env, argv }`),
   `spawn(opts): SessionHandle` (`events: AsyncIterable<AeosEvent>`,
   `providerSessionId`, `resumeToken?`, `costUsd?`, `kill()`),
   `translate(raw: unknown): AeosEvent[]`.
2. `conformance.ts`: exported `describeAdapterConformance(makeAdapter)` —
   Vitest suite factory asserting: profile is hermetic (no `$HOME` refs in
   env/argv), spawn yields well-formed canonical events (schema-parse every
   one), session id captured, kill() terminates, translate() is pure and
   total on the adapter's own fixture corpus.
3. `provider-fake.ts`: scripted adapter that replays a canonical-event
   fixture file with configurable pacing/exit — the CI workhorse for
   M6/M9 integration tests too.

*Accept (ROADMAP): provider-fake passes conformance.*
Commit: `feat(provider-core): HarnessAdapter contract + conformance suite + provider-fake [AEOS-P1.M4.T1]`

### Task 2: Hermetic profile builder  `[AEOS-P1.M4.T2]`

**Files:** `packages/provider-claude/` scaffold; `src/profile.ts`,
`test/profile.test.ts`

1. `profile.ts`: build per-agent profile under
   `<agent>/harness/claude` — `CLAUDE_CONFIG_DIR` pointed there, `--bare`
   always on, `settings.json` generated from `agent.yaml` feature toggles
   (plugins/skills/mcpServers/userClaudeMd/autoMemory → explicit re-enables
   via `--settings`/`--mcp-config`/`--plugin-dir`), `CLAUDE_CODE_DISABLE_*`
   env for everything toggled off.
2. Credential env injection by profile kind (from `CredentialProfile`):
   `api-key` → `ANTHROPIC_API_KEY`; `gateway` → `ANTHROPIC_BASE_URL` +
   `ANTHROPIC_AUTH_TOKEN` (+ optional `ANTHROPIC_MODEL`); `subscription` →
   explicit opt-in passthrough marker (no secret material written).
   Secret VALUES come from a caller-supplied resolver — M4 has no secret
   store (P2.M3); tests use a stub resolver.
3. Tests: generated profile contains zero references to `~/.claude` or
   `$HOME`; toggles round-trip (parse generated settings.json back);
   credential kinds map to exactly the documented env vars.

*Accept (ROADMAP): generated profile contains zero references to `~/.claude`; toggles round-trip.*
Commit: `feat(provider-claude): hermetic profile builder with credential env injection [AEOS-P1.M4.T2]`

### Task 3: Spawn/stream/translate  `[AEOS-P1.M4.T3]`

**Files:** `src/translate.ts`, `src/adapter.ts` (claude adapter),
`test/fixtures/*.ndjson` + `test/fixtures/*.expected.json`,
`test/translate.test.ts`, `test/adapter.test.ts`

1. `translate.ts`: Claude `stream-json` NDJSON → canonical events:
   `system/init` → `session.created` (+ capture `session_id`);
   assistant/user messages → `item.message`; `tool_use`/`tool_result` →
   `item.tool_call`/`item.tool_result`; `result` → `cost.usage` (from
   `total_cost_usd` + token counts, tagged with the credential profile id)
   then `session.completed`/`session.failed`. Unknown NDJSON lines →
   skipped with a counter, never a crash.
2. Adapter `spawn`: build argv `claude -p --output-format stream-json
   --verbose` + profile flags; child via the M3 runner's child-argv seam
   (the runner owns the process; the adapter owns argv/env + translation).
3. Fixtures: record real runs once (script `scripts/record-fixture.sh`,
   scrubbed), commit NDJSON + expected canonical JSON side by side.
4. Golden test: every fixture translates **byte-identically** (after
   stable-stringify) to its expected file; scrub test asserts no secrets.

*Accept (ROADMAP): golden fixtures (recorded from real runs) translate byte-identically to expected canonical event files.*
Commit: `feat(provider-claude): NDJSON→canonical translation with golden fixtures [AEOS-P1.M4.T3]`

### Task 4: Resume + credential-profile switching  `[AEOS-P1.M4.T4]`

**Files:** `src/resume.ts`, `test/resume.test.ts`

1. Resume: `spawn({resumeToken})` → `--resume <token>`; token = provider
   `session_id` captured in T3, stored by the caller in `session.yaml`
   (`providerSessionId` — contract field already exists).
2. Profile switch: rebuilding the profile with a different
   `CredentialProfile` takes effect on next spawn (never mid-process);
   `cost.usage` events carry the NEW profile id after the switch.
3. Fixture-driven test: fixture A (work, emits session_id), switch
   credential profile, fixture B (resumed continuation) — assert the same
   objective continues (resume token honored) and cost events flip
   profile id.

*Accept (ROADMAP): fixture-driven test proves same objective continues across profile switch.*
Commit: `feat(provider-claude): resume + credential-profile switching [AEOS-P1.M4.T4]`

### Task 5: Usage-limit auto-failover hook  `[AEOS-P1.M4.T5]`

**Files:** `src/failover.ts`, `test/failover.test.ts`

1. Detect the usage-limit condition from the stream (recorded
   `usage_limit` fixture). Policy input `onUsageLimit: 'confirm' | 'allow'`
   (full policy engine is P2.M1 — this is a scoped hook, not the engine):
   `confirm` → emit `approval.request` (documented action string);
   `allow` → emit switch decision so the caller respawns on the fallback
   profile (resume path from T4).
2. Tests simulate both policies against the fixture; document behavior in
   the package README.

*Accept (ROADMAP): simulated usage_limit fixture triggers documented behavior.*
Commit: `feat(provider-claude): usage-limit failover hook [AEOS-P1.M4.T5]`

## Milestone exit gate (ROADMAP M4)

> conformance + golden translation + live smoke (manual, budget-capped) pass.

Live smoke: `AEOS_LIVE_SMOKE=1 pnpm -F @aeos/provider-claude test:smoke` —
one tiny objective, hermetic profile, hard budget cap; run manually by
Kabeer, result recorded in the sprint log. At exit: flip M4 `[x]`, update
spec §5 tree (flat provider packages), R5 drift scan, close the sprint,
write the M5 plan (memory v0 — spec §8).
