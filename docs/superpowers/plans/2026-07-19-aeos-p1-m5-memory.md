# AEOS P1.M5 — Memory v0 (files as truth) — Implementation Plan

> **Cold-start brief.** Spec §8. Package `packages/memory` (`@aeos/memory`),
> deps: `@aeos/contracts` + `@aeos/kernel` entry points only. Files are
> truth; `index.db` holds only the rebuildable FTS index. Branch
> `feat/aeos-p1-m5-memory` from `main`. TDD; commits end `[AEOS-P1.M5.Tn]`;
> ROADMAP flips per task (R1). Note: executed ahead of the M4/M10 exit
> smokes per Kabeer's 2026-07-19 ship-directive; those smokes stay tracked
> in `guides/`.

### Task 1: Memory store  `[AEOS-P1.M5.T1]`
`src/layout.ts` + `src/store.ts` — spec §8 directory set; `MEMORY.md` with
YAML frontmatter declaring per-dir char budgets + index lines
(`- [Title](dir/file.md) — hook`). Ops: `writeMemoryFile` (typed
`OverBudgetError` when dir total would exceed budget — no silent
truncation), `archiveMemoryFile` (move under `.archive/<dir>/`, preserve
content), `consolidateMemoryFiles` (N → 1 within budget, originals
archived). Atomic writes via kernel `writeFileAtomic`.
*Accept: over-budget write returns typed error; archive preserves content.*

### Task 2: Snapshot composer  `[AEOS-P1.M5.T2]`
`src/snapshot.ts` — `composeSnapshot(root, {charBudget, relevance?})`:
index header + files in deterministic priority order (identity →
preferences → decisions → lessons → mistakes → architecture → rest
alphabetical; stable path sort within dirs; relevance terms only reorder
within a dir, deterministically). Files that don't fit are skipped whole
(no partial truncation). Same inputs → byte-identical output.
*Accept: byte-identical snapshots; ≤ budget.*

### Task 3: memory.propose queue + applier + index maintenance  `[AEOS-P1.M5.T3]`
`src/propose.ts` — proposals as files under `memory/.proposals/*.yaml`
(`write | archive | consolidate`); `applyProposals` executes each
atomically (store ops), regenerating the `MEMORY.md` index so its lines
always match the on-disk file set (`syncIndex`); failed proposals stay
queued with the error recorded.
*Accept: proposals applied atomically; index line always matches file set.*

### Task 4: FTS derived index + search  `[AEOS-P1.M5.T4]`
`src/fts.ts` — FTS5 virtual table `memory_fts(path, title, body)` created
on the kernel-provided `IndexDb`; `rebuildMemoryFts` (from files),
`updateMemoryFts` (single path), `searchMemory(db, query, k)`.
*Accept: rebuild-from-scratch equals incremental index results.*

## Exit gate
Memory survives reindex (delete db → rebuild → same search results) +
snapshot determinism tests green. No manual step — CI-verifiable.
