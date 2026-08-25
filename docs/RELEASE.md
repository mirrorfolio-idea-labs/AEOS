# Release escalation ladder

Three long-lived branches form the promotion path. Work escalates one tier
at a time through PRs; every hop has its own gate. Nothing lands directly on
a higher tier from a working branch.

```
feature / milestone branch        (e.g. feat/p2-m6-codex, overnight/*)
   │  PR ── Gate 1
   ▼
develop                           integration tier — always shippable-ish
   │  PR ── Gate 2                (promoted per milestone batch)
   ▼
staging                           pre-release verification tier
   │  PR ── Gate 3                (promoted per release candidate)
   ▼
main                              release tier — every merge may be tagged vX.Y.Z
```

## Gates

**Gate 1 — working branch → `develop`.**
The default target for every build PR. Requirements:
- CI-identical chain green (`pnpm install --frozen-lockfile && pnpm build &&
  pnpm typecheck && pnpm test && pnpm depcruise`), plus the ADE Playwright
  suite when UI changed.
- Every commit carries its stable task ID; ROADMAP checkboxes flipped in the
  completing commits (R1); PM views regenerated (R3).
- Any agent may open and merge these PRs once green (execution-owner rule,
  pm/README) unless the escalation triggers below apply.

**Gate 2 — `develop` → `staging`.**
Promote when a milestone batch is ready for integrated verification:
- Everything in Gate 1, run from the merged tip of `develop`.
- Exit gate evidence for each included milestone cited in the PR body
  (test counts, e2e/smoke artifacts — see `notes/` and sprint retros).
- Drift register reviewed: no open unresolved findings.
- Zero known P0/P1 defects in the batch.

**Gate 3 — `staging` → `main` (release).**
The only tier that produces tags:
- The relevant ROADMAP phase/milestone exit criteria are demonstrably met.
- Release notes drafted from the sweep/handoff notes covering everything
  since the last tag.
- **Kabeer (product/approval owner) opens-or-approves and merges this PR** —
  this is the sign-off step; agents prepare it but do not merge it.
- Merge is immediately followed by the semver tag (`vX.Y.Z`) on `main`.

## Escalation triggers — stop and ask Kabeer

An agent must not self-merge past Gate 1 (and must pause entirely) when the
change involves:
1. A new third-party dependency (list + rationale first — standing rule).
2. A contracts schema change that breaks existing consumers.
3. Rewriting ROADMAP accept text or touching locked decisions D1–D7
   (D2-precedent rewordings are Kabeer's call).
4. A hit goal-prompt/PM stop condition (ambiguous accepts, unresolvable
   drift, red bar requiring boundary/schema changes).
5. Security posture: secrets handling, auth/token layers, sandbox tiers.

## Hotfix path

`hotfix/<tag>-<slug>` branched **from `main`** → same Gate-1 checks → PR
straight back to `main` (Kabeer merges if post-release) → must be
cherry-picked to `develop` and `staging` so the tiers never diverge.

## Hygiene rules

- Tiers advance only forward (`develop` → `staging` → `main`); after any
  `main` merge or hotfix, sync both lower tiers immediately.
- No force-pushes to `develop`/`staging`/`main`, ever.
- Branch protection (recommended once the repo is public): required PR +
  green CI on all three; `main` additionally restricted to Kabeer's merge.
