# ADR-007 — v0.1 Slice: One Persistent, Resumable Agent (D6)

- **Status:** accepted — **superseded in scope, not in spirit** (see below)
- **Date:** 2026-07-12 (decision), updated 2026-07-19, documented 2026-07-20

## Context

The core thesis — "an agent is a durable object, not a chat" — needs to
be proven before multi-agent coordination, policy engines, or model
routing are built on top of it. Building those first, on an unproven
foundation, risks building the wrong foundation.

## Decision

v0.1 (Phase P1) proves the thesis with **one persistent agent per
objective**, resumable across daemon restarts via files-as-truth
checkpoints — no multi-agent delegation, no policy engine, no autonomous
planning. The golden-path E2E (M9.T1) is the literal test of this
thesis: create → work → `kill -9` → restart → resume → complete.

**Scope amendment, 2026-07-19 (Kabeer):** two extensions were pulled
into P1 without weakening the single-agent thesis: (a) **multi-account
subscription slots** (M4.T6) — still one agent per objective, but that
agent's *provider* can be any of several credentialed accounts,
concurrently with other agents' own sessions; (b) the **OpenCode
adapter** (P1.M10) — a second harness proving the provider abstraction
generalizes, not a second concurrency model. Neither introduces
cross-agent coordination.

## Consequences

- P1 shipped nine milestones (M1–M9) plus M10, all provably passing the
  single-agent resumability bar.
- Multi-agent delegation, the policy/approval engine, and secrets remain
  explicitly P2+ (`docs/ROADMAP.md`) — not silently pulled forward.
- The golden-path E2E is CI-enforced at 10 consecutive green runs
  (flake gate), so this decision has an automated, permanent regression
  test rather than a one-time manual demo.
