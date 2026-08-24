# Overnight session — 2026-08-25

**Mission:** verification gauntlet on v0.1.0, then cascade P2 → P3
milestone-by-milestone (just-in-time plans, quality gates at every exit).
Approved by Kabeer pre-session: "unwavering results, not a bloated run";
scope later widened mid-plan-approval to loop "towards complete P2 and P3,
slowly and with quality". Six-hour clock + original stop conditions live.

**Prompt-premise correction (logged up front):** the overnight prompt assumed
M1.T6 was next open and M2 unbuilt. Reality (verified vs code/git before
starting): P1 complete, `v0.1.0` tagged 2026-07-20, M1 6/6 and M2 kernel 5/5
merged through PR #110. Scope was re-based onto the actual repo state.

## Status

- [x] V0 drift scan (R5) — **CLEAN**: 107 tasks parsed, 48 [x], zero hard drift;
      soft finding logged below (P5.M1 has no plan file — spine exception).
- [x] V1 green bar from clean state — **PASS** 04:22: install --frozen-lockfile
      (better-sqlite3 gyp-built on Node 24), build ✓, typecheck ✓,
      211 passed / 2 skipped (env-gated live smokes) / 0 failed across 43 files,
      depcruise clean (317 modules / 962 deps).
- [x] V2 stress amplification — **ALL CLEAN, zero flakes**:
      full suite ×3 · kernel atomic/reindex/registry/codecs + scheduler
      checkpoint/plan ×20 · runner supervisor/handshake/frames/ring-buffer +
      daemon ×10 · golden-path e2e file ×12 (~120 daemon SIGKILL→resume
      cycles) · ADE Playwright ×2 (chromium headless-shell downloaded — env
      setup only; playwright pre-existing devDep). Logs in /tmp/opencode/.
- [x] V3 benchmarks — **DONE** (see Baselines below)
- [ ] Gate G0∧G1∧G2
- [ ] P2.M1 policy engine + approvals inbox (T1–T5)

## Log

### Pre-flight findings (plan phase)

- Repo clean at `f25fffd` ("docs: restore Hermes attribution…"), tag
  `v0.1.0` → `cb8b533` ancestry. 63 commits reference AEOS-P task IDs.
- All five required docs read. No guides/ dir in this clone (gitignored by
  design — manual smokes remain Kabeer-only, non-blocking).
- `notes/` did not exist; created it. Not gitignored, so this file gets
  committed at stop.
- vitest.workspace excludes apps/ade (Playwright-only suite) — the repo's own
  green bar does not cover UI tests; V2 runs Playwright explicitly ×2.
- No *.bench.ts files anywhere yet. Benchmarks will be new files using
  vitest's built-in bench mode — no new dependencies.

## Decisions made (not prespecified in repo)

1. **Benchmarks → scale tests where tinybench fails.** vitest bench recorded
   zero samples for better-sqlite3-heavy calls (reindex/transcript) despite
   clean execution — verified empirically across option variants, hooks,
   error capture (4 experiments), then time-boxed. Kept vitest bench only for
   the pure-JS event bus; converted the I/O-bound measurements into permanent
   scale tests (`kernel-scale.test.ts`, `snapshot-scale.test.ts`) that assert
   correctness at scale every CI run and print latencies as human baselines
   with NO wall-clock assertions (flake-proof by construction).
   Basis: user goal "unwavering results"; repo testing strategy §18.

## Performance baselines — 2026-08-25, Node 24.14, Linux x64 (this machine)

| Operation | Result |
|---|---|
| Event bus publish+deliver ×3 subscribers | ~15.2M deliveries/sec |
| Transcript append via bus (incl. SQLite route + mkdir+appendFileSync) | ~78k events/sec (2,500 in 32.0ms) |
| Warm reindex, 960 sessions / 32 agents | 51.6ms (~19k sessions/sec) |
| Cold reindex (delete index.db → reopen → rebuild) | 53.0ms |
| composeSnapshot, 208 files @40k budget | 15.2ms |
| composeSnapshot, 208 files, all included | 4.5ms |

No anomalies. All correctness asserts at scale green on first run.
