# AEOS P2.M6 — Codex Adapter Implementation Plan

> **For agentic workers:** task-by-task, in order. Full green bar
> (`pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`)
> before every commit; the completing commit flips that ROADMAP checkbox.

**Goal:** a third hermetic harness adapter — OpenAI Codex CLI (`codex exec
--json`) — translating its `thread/turn/item` stream into the canonical
taxonomy, with resume support, passing the provider-core conformance suite;
a cross-harness capability matrix asserted by tests, not hand-maintained.

**Unblocked 2026-08-26:** Kabeer installed codex-cli **0.149.1**
(ChatGPT-plan auth) — fixtures are RECORDED from real runs per spec §18,
never hand-written.

## Ground truth (recorded probes, codex-cli 0.149.1)

Headless `codex exec '<prompt>' --json` emits NDJSON lines:
```
{"type":"thread.started","thread_id":"<uuid>"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution",
  "command":"/bin/bash -lc 'echo x'","aggregated_output":"x\n","exit_code":0,"status":"completed"}}
{"type":"turn.completed","usage":{"input_tokens":..,"cached_input_tokens":..,
  "cache_write_input_tokens":..,"output_tokens":..,"reasoning_output_tokens":..}}
```
Resume: `codex exec resume <thread_id|--last>` continues a thread.
Sandbox note for recording: commands need `--sandbox danger-full-access`
in the recording script (scratch dirs only); the ADAPTER never passes that
by default — sandbox selection rides the policy compiler like every other
harness flag.

## Translation mapping (canonical ← codex)

| codex line | canonical event |
|---|---|
| `thread.started` | `session.created` `{}` — `thread_id` captured as providerSessionId |
| `turn.started` | `turn.started` `{}` |
| `item.completed` `agent_message` | `item.message` `{role:'assistant', text}` |
| `item.completed` `reasoning` | `item.message` `{role:'system', text}` (v0: reasoning surfaced as system text) |
| `item.completed` `command_execution` | `item.tool_call` `{name:'shell', input:{command}}` then `item.tool_result` `{output, exitCode}` |
| `item.completed` other/unknown types | `item.message` `{role:'system'}` fallback (additive forward-compat, D11 discipline) |
| `turn.completed` | `cost.usage` `{inputTokens, outputTokens, usd:0}` (codex reports tokens, not USD — capability matrix records costReporting as token-only) |

## Global constraints

- New package `@aeos/provider-codex` mirrors `provider-opencode` structure
  (profile builder, translate, adapter) so conformance parity is structural.
- Fixtures committed under `test/fixtures/` come from the recording script
  run against codex-cli 0.149.1 — never hand-edited; re-recording replaces
  whole files.
- Conformance: must pass the same `provider-core` suite as claude/opencode/fake.

---

### Task 1: Codex adapter (profile, spawn, translate, resume)  `[AEOS-P2.M6.T1]`

**Files:**
- Create: `packages/provider-codex/{package.json,tsconfig*.json}` name
  `@aeos/provider-codex`, deps `@aeos/contracts`, `@aeos/kernel`,
  `@aeos/provider-core`; workspace registration via `pnpm install`.
- Create: `src/profile.ts` — hermetic profile: per-agent `CODEX_HOME` dir +
  generated `config.toml` (disable update checks, set model prefs);
  credential env injection (`OPENAI_API_KEY` api-key kind; ChatGPT-login
  passthrough opt-in via slot homes like subscription slots).
- Create: `src/translate.ts` — pure line→events mapping per table above.
- Create: `src/adapter.ts` — `spawn()` runs `codex exec [--resume <thread>]
  --json -` in the profile env, parses stdout lines, yields canonical
  events; captures providerSessionId from `thread.started`.
- Tests:
  - `test/profile.test.ts` — generated config.toml contains no `$HOME`
    leakage; different slots yield isolated homes; toggles round-trip;
  - `test/translate.test.ts` — golden fixtures byte-identical:
    `fixtures/session.ndjson` → expected canonical JSONL; command_execution
    splits into tool_call+tool_result pair; unknown item types fall back
    additively; usage → cost.usage mapping;
  - `test/resume.test.ts` — resume fixture continues a thread (same
    thread_id, next-turn content present);
  - conformance green alongside claude/opencode/fake.
- Fixture recording: `scripts/record-fixtures.sh` (env-gated, documented)
  producing `fixtures/*.ndjson` from live runs; outputs committed once and
  replayed in CI forever after.

**Steps:** RED translate golden tests (fixtures first!) → implement
translate → RED profile/conformance → implement → full green bar → commit
`feat(provider-codex): codex adapter — profile, spawn, translate, resume [AEOS-P2.M6.T1]`.

---

### Task 3: Cross-harness capability matrix + docs  `[AEOS-P2.M6.T3]`

(T2 was retired 2026-07-19 when OpenCode moved to P1.M10.)

**Files:**
- Modify: `packages/provider-core/src/conformance.ts` (or adjacent) —
  machine-readable capability assertions per adapter id (hermeticProfile,
  structuredOutput, resume, costReporting fidelity), checked against what
  each adapter actually registers; docs section in README table generated
  from the same source.
- Tests: matrix consistency test — every registered adapter satisfies the
  claims it makes (no hand-maintained drift).

**Steps:** RED matrix test → wire claims → docs → full green bar → commit
`feat(provider-core): cross-harness capability matrix [AEOS-P2.M6.T3]`.

---

## Exit gate (P2.M6)

The same fixture objective completes on all adapters (fake, Claude,
OpenCode, Codex) — asserted by the conformance run over each adapter's
golden path. All checkboxes `[x]`, R5 rescan clean, S10 closed with retro,
BOARD synced.
