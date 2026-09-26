# AEOS v0.2.0 — Safety + polish

Everything since `v0.1.0` (2026-07-20). **Phase P2 exit gate: green**
(`apps/aeosd/test/p2-exit.e2e.test.ts`).

## Highlights

- **Least privilege by default** (P2.M1).
  - Tiered permissions, layered policy YAML, daemon-side enforcement.
  - An approvals inbox; every confirm-tier action parks for a human.
- **Budgets and audit** (P2.M2).
  - Daemon-enforced USD and token caps with resume-with-increase.
  - An append-only audit log.
- **Secrets** (P2.M3). An age-encrypted store, policy-gated injection, and
  redaction across the whole pipeline (proved by a canary test).
- **Memory curator** (P2.M4). An idle-triggered, dry-run proposal pipeline.
- **Human takeover** (P2.M5). A PTY attach restricted to the allow tier, an
  xterm Takeover tab, and a co-edit guard (ADR-009).
- **Three harnesses** (P2.M6). Claude Code, OpenCode and Codex, with
  capability parity enforced by a test.
- **Managed harness binaries** (P2.M7).
  - Pinned, npm-integrity-verified installs sealed by a tree hash.
  - A pin never falls back to PATH.
  - Version-gated capabilities.
  - `aeos harness install|verify|list|pins`.
- **Real repository work** (P2.M9).
  - Repo bindings and one git worktree per objective; your checkout is never
    touched.
  - One agent-authored commit per task.
  - Sessions now receive a full brief: objective, definition of done, plan
    position and the memory snapshot.
  - A review pane (API, CLI, ADE) that sends line comments back to the agent
    as a follow-up task.
- **Agent runtime** (P2.M10, adapted from herdr).
  - Live attention status per agent. PTY takeovers are classified with
    herdr's Apache-2.0 detection manifests.
  - A race-free `wait`.
  - An attention-sorted inbox with triage.
  - Phone and Slack push via `notifications.yaml`.
- **Desktop app** (P2.M8). A Tauri 2 shell with native notifications and
  `aeos://` deep links; unsigned Linux and macOS installers from CI.

## Fixes worth knowing

- **Resume tokens.** Provider resume tokens were silently dropped whenever
  policy enforcement was on, which it always is in the daemon. Crash-resume
  therefore restarted provider sessions from scratch. Now fixed.
- **Desktop app.** It no longer orphans a daemon it started when it receives
  SIGTERM.

## Upgrade notes

- All contracts changes are additive:
  - `AgentConfig.repos`, `AgentConfig.harness.binaryPath`;
  - `Objective.repo`;
  - the `agent.status_changed` event.

  Existing homes load unchanged. Agents' `.gitignore` gains `status.json` and
  `attention.json` on their next update.
- To pin a harness, run `aeos harness install <harness>@<version>` before
  setting `--harness-version`.

## Known limits / still open

- The Claude and OpenCode live smokes are manual (P1.M4, P1.M10).
- Desktop installers are unsigned; signing lands in P5.M3.
