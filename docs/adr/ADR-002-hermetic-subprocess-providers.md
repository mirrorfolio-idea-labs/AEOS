# ADR-002 — Execution Substrate: Hermetic Subprocess Providers (D1)

- **Status:** accepted
- **Date:** 2026-07-12 (decision), documented 2026-07-20 at P1 exit

## Context

AEOS needs a way to actually get coding work done. Building a first-party
agentic loop from scratch (tool use, context management, model calls)
duplicates years of tuning already inside Claude Code, Codex CLI, and
OpenCode.

## Decision

Wrap existing agent CLIs as **hermetic subprocess providers**: spawn the
CLI in `--print`/non-interactive streaming mode inside a clean config
home, translate its native event stream into the AEOS canonical taxonomy
(`packages/contracts`), and treat the `HarnessAdapter` interface
(`packages/provider-core`) as the only thing that knows a specific
provider exists.

## Consequences

- Fastest path to a working system — AEOS inherits mature tool loops
  instead of re-deriving them.
- Provider-agnostic by construction: `provider-claude` and
  `provider-opencode` (P1.M4, P1.M10) both implement the same contract
  and pass the same conformance suite; Codex (P2.M6) follows the same
  pattern.
- Cost: AEOS is bounded by what each CLI exposes (no finer-grained
  control than the CLI's own flags/output format).
