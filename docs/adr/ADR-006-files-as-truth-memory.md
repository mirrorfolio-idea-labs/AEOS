# ADR-006 — Memory: Files as Truth + Derived Indexes (D5)

- **Status:** accepted
- **Date:** 2026-07-12 (decision), documented 2026-07-20 at P1 exit

## Context

An agent's memory needs to be inspectable, diffable, portable across
machines, and safe to lose an index for. A database-as-truth design
fails all four.

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
