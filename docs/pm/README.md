# AEOS Project Management System — Operating Manual

This directory is the project's Notion/Jira equivalent, implemented as plain
Markdown under git. It sits **on top of** the existing documentation — it never
replaces it. Every fact lives in exactly one place; everything else links.

## Artifact map (single source of truth)

| Fact | Owned by | Everything else |
|---|---|---|
| Requirements & architecture | `docs/superpowers/specs/2026-07-12-aeos-architecture-design.md` | links to spec §sections |
| Build task IDs, one-line accepts, **status markers** | `docs/ROADMAP.md` (the drift anchor) | BOARD/sprints/cards link by ID, never restate status |
| Step-by-step execution detail per milestone | `docs/superpowers/plans/<date>-<milestone>.md` | task cards link to the plan section |
| What is actually true about the code | the code + git history + test runs | docs yield to code on conflict (see R4) |
| Sprint scope & PM tasks (`PM-S<nn>-<n>`) | `docs/pm/sprints/S<nn>.md` | BOARD links |
| Delegation context per active task | `docs/pm/tasks/<TASK-ID>.md` | created just-in-time, archived on completion |
| Board & traceability | `docs/pm/BOARD.md`, `docs/pm/TRACEABILITY.md` | **generated views** — regenerate, never hand-patch facts |

## Hierarchy

- **Epic** = Phase (`P1`–`P4`) — registered in [`EPICS.md`](EPICS.md).
- **Milestone** = `M1`–`M9` per phase — defined in `docs/ROADMAP.md` with an exit gate.
- **Sprint** = a time-boxed slice, normally "finish milestone N / open N+1" — one file per sprint in `sprints/`.
- **Task** = atomic unit. Two ID namespaces:
  - `AEOS-P<p>.M<m>.T<t>` — build tasks. Minted **only** in `docs/ROADMAP.md`; IDs are stable forever; commits must reference them.
  - `PM-S<nn>-<n>` — process/doc/cleanup tasks. Minted **only** in the sprint file that owns them.

Status legend everywhere: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked.

## Lifecycle rules

**Sprint planning.** When a milestone's predecessor exit gate passes: author the
milestone plan (per ROADMAP header), open `sprints/S<nn>.md`, create task cards
in `tasks/` **only for tasks entering execution**. Cards for far-future tasks
are forbidden — they would duplicate the spec and go stale.

**Execution.** Every commit that advances a task references its ID in the
commit message. The commit that satisfies a task's accept criteria flips its
ROADMAP checkbox **in the same commit**.

**Completion.** At milestone exit: flip the milestone marker, run the drift
scan (below), move completed task cards to `tasks/archive/`, close the sprint
file with a retrospective section, regenerate BOARD + TRACEABILITY.

## Sync protocol (self-healing rules)

- **R1 — status follows commits.** A task is `[x]` only when its accept
  criteria are verifiably met (tests green). The flip happens in the commit
  that earns it.
- **R2 — bidirectional updates.** A code change that alters behavior described
  in the spec/plans updates those docs in the same PR. A doc change that
  creates or changes work must add/adjust a task (ROADMAP or sprint) in the
  same commit.
- **R3 — views are generated.** `BOARD.md` and `TRACEABILITY.md` carry an
  "as of `<commit>`" header. Any status-changing commit regenerates them. Never
  edit a fact there that is owned elsewhere.
- **R4 — code wins.** On any doc-vs-code inconsistency, or any doubt, verify
  against the code (`pnpm test`, `git log`, read the source) and correct the
  doc, logging the fix in the BOARD drift register.
- **R5 — drift scan.** Run at every milestone exit and whenever picking up the
  project cold:
  1. `git log --oneline main..HEAD` + `git log --grep 'AEOS-P'` — every commit
     task-ID must have a matching ROADMAP marker state; unchecked-but-committed
     (or vice versa) ⇒ drift.
  2. `pnpm install && pnpm build && pnpm test` — claimed-done tasks must be green.
  3. Milestone marked `[~]`/`[x]` must have a plan file; a plan file must have
     a ROADMAP entry.
  4. Cards in `tasks/` (non-archive) must belong to the open sprint.
  5. BOARD "as of" commit must be an ancestor of HEAD ≤ the last status change.
  Findings go in the BOARD **drift register** with an owner task; fixes that
  are pure bookkeeping are applied immediately.
- **R6 — no duplicates.** Before creating any doc, search `docs/` for prior
  art. Overlapping/conflicting docs are logged in the drift register with a
  merge proposal; the merge decision is Kabeer's.

## Delegation protocol

Any `[ ]` task with a card in `tasks/` must be executable by a weaker coding
agent (GLM-class, IDE agent) with **zero conversation history**. A card must
contain: objective (1 sentence) · repo context (layout, toolchain, commands) ·
link to the exact plan section for step-level detail · dependencies and their
status · acceptance criteria (link + quoted excerpt marked with its source) ·
verification commands · out-of-scope list · commit-message format. Template:
[`tasks/_TEMPLATE.md`](tasks/_TEMPLATE.md).

## Ownership defaults

- **Product/approval owner:** Kabeer (merges, scope changes, spec amendments).
- **Execution owner:** any competent agent, unless a card names one.
- **PM system maintenance:** whichever agent touches the repo — the rules
  above are self-enforcing; there is no separate PM role to wait on.
