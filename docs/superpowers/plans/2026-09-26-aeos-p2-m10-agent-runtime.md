# AEOS P2.M10 — Agent Runtime (herdr-derived)

**Goal:** make AEOS tell you, reliably and without watching a terminal, which
agent needs you. That is herdr's core value: detect whether an agent is
working, blocked or done, wait on it programmatically, triage many agents
from one inbox, and get pinged on your phone.

## What was taken from herdr and how

| herdr piece | License | AEOS adoption |
|---|---|---|
| Detection manifests `claude/codex/opencode.toml` | Apache-2.0 | Copied verbatim into `packages/runner/manifests/`, with `NOTICE.md` and `LICENSE-herdr`; local overrides go in `<home>/agent-detection/` |
| Rule engine (regions, contains/regex/line_regex, any/all/not, priority) | Apache-2.0 | Independent TypeScript reimplementation (`runner/src/detect/rules.ts`); Rust regex is translated to JS |
| Screen capture | — | `@xterm/headless` renders the PTY; OSC title and progress are captured |
| `agent wait --until blocked` | Apache-2.0 | Idea only: a long-poll `wait` with `afterSeq` for race-free act-then-wait |
| herdr-agent-inbox (settle / unread / attention sort) | MIT | Idea only: `/v1/inbox` plus the ADE sidebar |
| herdr-remote (phone push) | AGPL-3.0 | Idea only: plain outbound webhooks (json, ntfy, slack) |

**Not adopted:**
- herdr's terminal multiplexer, layouts and TUI. AEOS runs harnesses headless
  and the ADE is its UI.
- herdr's lifecycle hooks. AEOS already gets structured events from every
  adapter, which is stronger than screen scraping for headless runs.

## Design

- **Status sources.**
  - Headless runs: status is folded from the canonical events (`observe`).
  - Run lifecycle: start → working; completed → done; paused or errored →
    blocked.
  - PTY takeovers: screen rules apply (idle → done, unknown ignored).
- **Tracker.** One per home, shared by the API server and the daemon's
  resume path. It persists `<agent>/status.json` so `seq` stays monotonic
  across restarts; a stale `working` reads as idle. It emits
  `agent.status_changed` (a new contracts event, additive, with a golden
  fixture) only on a real change, or on a new reason for being blocked.
- **Attention.** `<agent>/attention.json` holds `{seenSeq, unread,
  settledSeq}`. A settle holds only until `seq` passes it. Runtime files are
  gitignored in agent repos; older agents get the entries appended on their
  next update.

## Found and fixed along the way

`guardAdapter` spread the session handle (`{...handle, events}`). That copied
the `resumeToken`, `providerSessionId` and `costUsd` getters as `undefined`
at spawn time. As a result:
- Under policy enforcement (always on in the daemon), no checkpoint ever
  recorded a provider resume token.
- Crash-resume therefore restarted provider sessions from scratch.

The wrapper now delegates through getters. The regression test fails without
the fix.

## Verification

- `runner/test/detect.test.ts`: all three manifests compile; Claude
  idle/working/permission, Codex OSC, OpenCode banner; regions; a headless
  xterm with ANSI; local override.
- `api/test/runtime.test.ts`: working → done, the bus events, wait with a
  timeout, approval → blocked plus an ntfy push, inbox triage including
  auto-unsettle, restart persistence, notification rendering.
- `api/test/attach.test.ts`: a takeover permission prompt yields blocked via
  the screen rule.
- ADE Playwright T7: a fresh agent parks → inbox "needs you" → approve →
  "finished" → settle.
- Full bar: 380 passed / 2 skipped across 79 files; Playwright 8/8 locally.

New dependencies (pre-approved 2026-09-26): `@xterm/headless` (MIT) and
`smol-toml` (BSD-3-Clause).
