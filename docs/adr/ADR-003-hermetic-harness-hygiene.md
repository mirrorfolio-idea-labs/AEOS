# ADR-003 — Harness Hygiene: Clean Config Home by Default (D2)

- **Status:** accepted
- **Date:** 2026-07-12 (decision), documented 2026-07-20 at P1 exit

## Context

If every agent session inherited the operator's real `~/.claude` or
`~/.config/opencode`, an agent's behavior would silently depend on
whatever plugins, skills, or global config happened to be installed on
the host machine at the time — and agent A's session could pollute agent
B's environment (or the operator's own).

## Decision

Every harness spawn is **hermetic by default**: a clean, per-agent config
home (`CLAUDE_CONFIG_DIR` / `XDG_CONFIG_HOME` et al. pointed at
`<agent>/harness/<provider>/`), with every optional feature
(plugins, skills, MCP servers, user memory) off unless the agent's
`agent.yaml` toggles re-enable it explicitly via provider-native flags.

## Consequences

- Prevents corruption of an agent's self-learning by host-machine
  customizations that vary session to session.
- Every generated profile is tested to contain zero references to the
  real home directory (`provider-claude`/`provider-opencode` test
  suites, M4/M10).
- Subscription-based auth needed a variant: named account **slots** each
  get their own persistent login home (`AEOS_HOME/subscriptions/<slot>`)
  so hermeticity and "reuse my Pro/Max login" aren't in tension
  (M4.T6, scope addition 2026-07-19).
