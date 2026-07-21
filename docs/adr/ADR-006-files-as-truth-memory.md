# ADR-006 — Memory: Files as Truth + Derived Indexes (D5)

- **Status:** accepted
- **Date:** 2026-07-12 (decision), documented 2026-07-20 at P1 exit

## Context

An agent's memory needs to be inspectable, diffable, portable across
machines, and safe to lose an index for. A database-as-truth design
fails all four.

## Prior art

The concrete memory rules here are **derived from, and hardened beyond,
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)**
("Hermes", spec §3): hard character-budgeted memory files where overflow
is an explicit error the agent must resolve rather than silent
truncation; frozen-snapshot memory injection for prompt-cache stability;
a background Curator that ages and archives but never deletes; FTS +
summarization for cross-session recall. What AEOS does **not** take from
Hermes: its single-memory-provider limitation and two-file-only layout —
`packages/memory` uses the full spec §8 directory structure instead.

(Note: "Hermes" here is this specific prior-art project, unrelated to
"hermetic" — the adjective used elsewhere in these ADRs, e.g. ADR-003,
for isolated/sandboxed harness config homes. Same syllables, different
concepts.)

## Decision

Memory lives as **plain Markdown files** under a fixed directory
structure (`packages/memory`, spec §8) with a `MEMORY.md` index carrying
per-directory character budgets. SQLite FTS5 is a **derived, rebuildable
cache** — `rebuildMemoryFts` from the files always reproduces the same
index as incremental updates (proven by test, M5.T4). Writes that would
exceed a directory's budget fail with a typed error rather than silently
truncating.

## Consequences

- `rm -rf index.db && reindex` is a safe, routine, tested operation for
  both the kernel's session index (M2) and the memory FTS index (M5) —
  not a disaster-recovery procedure.
- Memory is `git diff`-able and portable: copy the directory to a new
  machine and everything (including full-text search, after one rebuild)
  works.
- The frozen-snapshot composer (`composeSnapshot`) guarantees
  byte-identical output for identical inputs, which is what makes
  provider-side prompt caching viable across sessions.
