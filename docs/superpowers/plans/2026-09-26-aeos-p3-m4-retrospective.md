# AEOS P3.M4 — Retrospective / Self-Learning Loop

## Design

- `scheduler/src/retrospective.ts` `runRetrospective` runs after every
  objective run, including paused ones; `retrospective: off` skips it.
  It compares the plan with what actually happened, deterministically
  (v0, like the curator, with no model call):
  - failed or flaky verification (checkpoint `verification`, strikes) →
    `lessons/verification-<obj>.md`, naming the command, the task and the
    first output line, plus "run X before finishing";
  - tasks that needed re-dos → `mistakes/redos-<obj>.md`;
  - human review comments (`tasks/R<n>.md` from the P2.M9 review pane) →
    `preferences/review-<obj>.md`.
- Everything goes through `memory.propose`, never a direct write (spec §8
  rule 2). Proposal ids are stable, so a re-run never double-queues.
- **Accepting:**
  - `GET /v1/memory/proposals`,
    `POST /v1/memory/proposals/apply {ids?}` (emits `memory.written` and
    rebuilds FTS), `POST /v1/memory/proposals/:id/reject`;
  - SDK `memoryProposals`/`applyMemoryProposals`/`rejectMemoryProposal`;
  - CLI `aeos memory proposals|accept|reject`;
  - an ADE Files tab card with Accept/Reject.
  - `Objective.retrospective: apply` accepts immediately for unattended
    runs (P3 exit demo). The contracts change is additive.
- **T2:** accepted `preferences/` and `lessons/` files reach the next
  session through the existing snapshot (`composeSnapshot` in the P2.M9
  session brief).
- Memory also gains selective `applyProposals(..., {ids})` and
  `rejectProposal`.

## Verification (`api/test/retrospective.test.ts`, 10 of 10 stable)

- **T1:** a fixture objective (verify fails once, then a review comment)
  produces exactly the expected lesson and preference proposal bytes, and
  memory is untouched until they are accepted.
- **T2 and the exit gate:** after acceptance, objective 2's session brief
  contains objective 1's preference and lesson **byte for byte**.
- Reject drops a proposal, and re-running the retrospective does not
  duplicate.
- `retrospective: apply` writes memory at once; a clean objective proposes
  nothing.
- Full bar: 412 passed / 2 skipped; Playwright 10/10.
