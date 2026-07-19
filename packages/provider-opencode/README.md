# @aeos/provider-opencode

OpenCode harness adapter for AEOS (spec §9, P1.M10 — pulled forward from
P2 so v0.1 ships with a second harness). Mirrors `@aeos/provider-claude`:
hermetic profiles, event translation, resume, BYOK with multi-account
subscription slots, fixture-driven tests.

## Hermetic profile

All four XDG homes point inside `<agent>/harness/opencode/`
(`config/`, `data/`, `state/`, `cache/`), `OPENCODE_DISABLE_PROJECT_CONFIG=1`
is always set, and a generated `config/opencode/opencode.json` mirrors the
agent's feature toggles. The user's real `~/.config/opencode` is never
referenced.

Credentials (values via a caller-supplied `SecretResolver`): `api-key` →
`ANTHROPIC_API_KEY` · `gateway` → `ANTHROPIC_BASE_URL` +
`ANTHROPIC_AUTH_TOKEN` (+ `ANTHROPIC_MODEL`) · `subscription` → the slot's
persistent **data home** (OpenCode keeps `auth.json` under `XDG_DATA_HOME`;
one `opencode auth login` inside binds one account) with config/state/cache
staying per-agent. Different slots run concurrently on different accounts.

## Spawn + translation

`OpencodeAdapter.spawn` runs `opencode run <objective> --format json`
(+ `--session <id>` when resuming) over the injectable `RunChild` seam.
Mapping: first event carrying a `sessionID` → `session.created`;
text parts → `item.message`; terminal tool parts → `item.tool_call` +
`item.tool_result`; assistant `message.updated` with cost → `cost.usage`
(profile-tagged); `session.idle` → `session.completed`; `session.error` →
`session.failed`. Unknown lines are counted, never fatal.

Golden fixtures live in `test/fixtures/` — re-record with
`scripts/record-fixture.sh`. Live smoke: `AEOS_LIVE_SMOKE=1 pnpm -F
@aeos/provider-opencode test:smoke`.
