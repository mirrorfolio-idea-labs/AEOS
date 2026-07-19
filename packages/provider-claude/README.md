# @aeos/provider-claude

Claude Code harness adapter for AEOS (spec §9): hermetic per-agent
profiles, `stream-json` → canonical-event translation, resume, BYOK
credential switching, and a usage-limit failover hook.

## Hermetic profile

`buildClaudeProfile` roots everything under `<agent>/harness/claude`
(`CLAUDE_CONFIG_DIR`), always passes `--bare` + `--settings`, and never
references the user's `~/.claude`. Feature toggles from `agent.yaml` are
hermetic-by-default:

| Toggle off (default) | Toggle on |
|---|---|
| `CLAUDE_CODE_DISABLE_PLUGINS=1` | `--plugin-dir <profile>/plugins` |
| `CLAUDE_CODE_DISABLE_MCP=1` | `--mcp-config <profile>/mcp.json` |
| `CLAUDE_CODE_DISABLE_SKILLS=1` / `_USER_CLAUDE_MD=1` / `_AUTO_MEMORY=1` | re-enabled via generated `settings.json` |

Credential kinds map to env vars (values via a caller-supplied
`SecretResolver`; the daemon secret store lands in P2.M3):
`api-key` → `ANTHROPIC_API_KEY` · `gateway` → `ANTHROPIC_BASE_URL` +
`ANTHROPIC_AUTH_TOKEN` (+ `ANTHROPIC_MODEL`) · `subscription` →
`AEOS_CREDENTIAL_PASSTHROUGH=subscription` marker only. Secrets never
touch argv or any file.

## Spawn + translation

`ClaudeAdapter.spawn` builds
`claude -p <objective> --output-format stream-json --verbose` plus the
profile flags (`--resume <token>` when resuming) and streams translated
canonical events. The child process is owned by the M3 runner via the
injectable `RunChild` seam. Mapping: `system/init` → `session.created`
(captures `session_id`); content blocks → `item.message` /
`item.tool_call` / `item.tool_result`; `result` → `cost.usage` (tagged
with the paying credential profile id) then `session.completed` /
`session.failed`. Unknown lines are counted, never fatal.

Golden fixtures live in `test/fixtures/` — re-record with
`scripts/record-fixture.sh` (scrubbed; a test rejects anything matching a
secret pattern).

## Resume + credential switching

`SessionHandle.resumeToken` is the provider session id — persist it
(`session.yaml: providerSessionId`) and feed it to `buildResumeSpawn` to
continue the same objective. Switching credentials = rebuild the profile
with another `CredentialProfile`; it takes effect on the next spawn, never
mid-process, and subsequent `cost.usage` events carry the new profile id.

## Usage-limit failover

`evaluateUsageLimit(events, opts)` after a failed session:

- **`policy: 'confirm'`** → returns an `approval.request` event
  (`action: "provider.credential_failover"`, expiry default 15 min);
  the daemon parks the session in `waiting_approval` and deny-by-default
  applies on timeout.
- **`policy: 'allow'`** → returns
  `{ kind: 'switch', fallbackProfileId, resumeToken }`; the caller rebuilds
  the profile on the fallback credential and respawns via the resume path.
- Any other failure (or success) → `{ kind: 'none' }`.
