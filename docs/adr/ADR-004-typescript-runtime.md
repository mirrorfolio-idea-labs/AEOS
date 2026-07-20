# ADR-004 — Runtime Language: TypeScript/Node (D3)

- **Status:** accepted
- **Date:** 2026-07-12 (decision), documented 2026-07-20 at P1 exit

## Context

AEOS needs one implementation language for v0.1 through v1.0. The choice
should optimize for ecosystem fit today without locking the architecture
to that choice forever.

## Decision

**TypeScript on Node 22**, but the architecture is optimized for
*replaceability*, not for TypeScript: every module boundary is a
versioned wire contract (`packages/contracts` — Zod + JSON Schema),
never a shared in-process type. A component could be rewritten in
another language without its consumers noticing, because consumers only
ever see the contract.

## Consequences

- Ecosystem fit: the CLIs we wrap (Claude Code, Codex, OpenCode), MCP
  tooling, and the web UI are all naturally TypeScript/Node-first.
- `dependency-cruiser` enforces that packages talk only through published
  entry points, keeping the replaceability property real rather than
  aspirational.
- Contracts are exported as language-neutral JSON Schema specifically so
  a future non-TS component (a Rust runner, a Go scheduler) could
  implement the same wire format.
