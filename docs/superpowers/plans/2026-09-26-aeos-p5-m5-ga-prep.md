# AEOS P5.M5 — GA launch prep (the parts an agent can do)

## T2 — upgrade verification
- `scripts/release/upgrade-test.mjs <ref>…` does the following for each
  ref:
  1. Builds the baseline release in a git worktree.
  2. Uses the baseline daemon (demo provider, over the HTTP subset every
     version shares) to create a workspace and an agent, complete one
     objective and leave one unstarted.
  3. Stops the baseline daemon.
  4. Boots **this** build on the same `AEOS_HOME` and asserts that
     workspace, agent and the completed objective (with checkpoints) are
     intact, that the pending objective runs to completion (approving
     anything that parks), and that the log shows no errors.
- The `upgrade` job in `release.yml` runs it on every release and dry run,
  against the previous tag and `staging`. The GitHub Release waits for it.
- Verified locally: **v0.1.0 → current PASS; origin/staging (v0.2
  candidate) → current PASS.**
- `notes/release-v1.0.0.md` is drafted, including upgrade notes and
  download verification.

## T3 — launch kit
- `notes/launch/` holds the blog post, Show HN, the X/LinkedIn/Reddit
  posts and awesome-list targets. Each draft lists the CI evidence behind
  every claim.

## Left for humans
- T1 blocker burn-down happens at cut time. The triage labels (P0/P1) and
  the rule "no release ships with an open P0/P1" are in place (P5.M4.T2).
- The `v1.0.0` tag (Gate 3), publishing the announcement, and the
  post-launch week (T4).
