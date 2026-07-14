# AEOS P1.M3 — Session Runner + Supervisor — Implementation Plan

> **Cold-start brief.** Milestone M3 of the AEOS build (`docs/ROADMAP.md`;
> spec §4, §10). M1 (contracts) and M2 (kernel: layout/atomic/codecs, derived
> index, registry, event bus, lifecycle, `apps/aeosd`) are on `main`, all
> green. M3 builds the durable execution layer: **one supervised OS process
> per live session that survives daemon restarts** (Superset pattern). Work on
> branch `feat/aeos-p1-m3-runner` from `main`.

## Global constraints

- Same toolchain/config pattern as M2 (copy `packages/kernel` scaffolding).
  New package: `packages/runner` (`@aeos/runner`) — may depend on
  `@aeos/contracts` and `@aeos/kernel` **published entry points only**.
- **Topology (locked):** the runner is the socket **server** (listens on a
  Unix socket inside its session dir); the daemon is the **client**. On
  daemon restart, the daemon reconnects using `socketPath` from
  `session.yaml`. This is what makes re-adoption possible.
- **Wire messages** live in `packages/runner` (daemon↔runner internal
  protocol, both ends in-repo); the version constant comes from
  `@aeos/contracts` `PROTOCOL_VERSION`. Session/user-visible events remain
  the canonical taxonomy. Record this placement decision in the T1 commit.
- Runner writes its transcript locally (append NDJSON in its session dir) —
  a daemon crash loses nothing (spec §10).
- No PID-based identity: `session.yaml` carries `{runnerPid, socketPath}` as
  runtime metadata; identity is the AEOS session ULID (spec §7).
- TDD per step; commits end `[AEOS-P1.M3.Tn]`; task checkbox flips in the
  completing commit (PM rule R1).

### Task 1: Framed protocol codec + versioned handshake  `[AEOS-P1.M3.T1]`

**Files:** `packages/runner/` scaffold; `src/protocol/frames.ts`,
`src/protocol/messages.ts`, `test/frames.test.ts`, `test/handshake.test.ts`

1. `frames.ts`: encode/decode `4-byte BE length + UTF-8 JSON` frames over a
   streaming source. Decoder is an incremental state machine
   (`push(chunk): Message[]`) — no assumption that one chunk = one frame.
   Max frame size (1 MiB) → typed `FrameSizeError`.
2. `messages.ts` (Zod, versioned): `hello {v, minV, maxV, sessionId}` /
   `helloAck {v, lastSeq}` / `event {seq, event: AeosEvent}` /
   `heartbeat {seq?}` / `replay {fromSeq}` / `stop {reason}` /
   `protoError {code, message}`. Handshake negotiation: overlap of min/max
   ranges → agreed `v`; no overlap → `protoError` + close, typed
   `VersionMismatchError` client-side.
3. **Fuzz test (accept):** random valid message sequences re-chunked at random
   boundaries (split + merged) decode identically; 1000 iterations with a
   seeded PRNG (print seed on failure). Version-mismatch test: (min 2, max 3)
   vs (min 1, max 1) → typed error on both ends.

*Accept (ROADMAP): fuzz test (split/merged frames) decodes correctly; version mismatch → typed error.*
Commit: `feat(runner): framed protocol codec + versioned handshake [AEOS-P1.M3.T1]`

### Task 2: Runner process  `[AEOS-P1.M3.T2]`

**Files:** `src/runner/runner.ts`, `src/runner/ring-buffer.ts`,
`src/runner/main.ts` (executable), `test/ring-buffer.test.ts`,
`test/runner.test.ts`

1. Ring buffer: fixed capacity (default 1024), monotonically increasing
   `seq`; `since(seq)` returns retained tail; overwrite oldest. Property
   tests.
2. Runner core (constructor args: sessionId, sessionDir, socketPath, child
   argv, timeouts): spawn child; wrap each stdout/stderr line as a canonical
   `item.message` event (assistant/system roles; provider translate arrives
   in M4); buffer + append to local `transcript.ndjson`; listen on the Unix
   socket; on client connect → handshake → replay from client's `lastSeq` →
   stream live.
3. Liveness: heartbeat every 2s to connected clients; hard timeout kills the
   child and emits `session.failed`; `STOP` file at `$AEOS_HOME/STOP` or
   session dir checked every heartbeat tick → graceful child stop (spec §17.5;
   full kill-switch UX lands in P1.M9.T3).
4. **Disconnect test (accept):** start runner with a slow-emitting child,
   connect a fake daemon client, disconnect it mid-stream, keep the child
   running, reconnect with `lastSeq` → no event lost, child never restarted.

*Accept (ROADMAP): runner survives daemon socket disconnect and keeps child alive.*
Commit: `feat(runner): durable session runner process with ring-buffer replay [AEOS-P1.M3.T2]`

### Task 3: Supervisor + re-adoption  `[AEOS-P1.M3.T3]`

**Files:** `src/supervisor/supervisor.ts`, `test/supervisor.test.ts`,
integration wiring in `apps/aeosd/src/daemon.ts` (new `supervisor` module)

1. `startSession(...)`: create session dir + `session.yaml`
   (state `created→starting`), spawn detached runner (`node …/runner/main.js`),
   record `{runnerPid, socketPath}`, connect, handshake, `running`.
   Republish runner events onto the kernel bus (transcript writer already
   handles persistence — runner-local transcript is authoritative; daemon
   side dedups by event `id` when both wrote: keep it simple — daemon does
   NOT append for supervised sessions; the runner owns the file. Wire
   `attachTranscriptWriter` to skip events whose session has a live runner.)
2. `adoptOrphans()` on daemon boot: scan `sessions/*/session.yaml` with state
   `running|starting`; try connect+handshake at `socketPath`; success →
   re-adopt (replay from last indexed seq), failure → state `orphaned` +
   `session.orphaned` event (recovery via plan re-entry arrives in M6).
3. **Re-adoption integration test (accept, flagship):** start a session
   (child emits numbered lines every 100ms), kill the *daemon-side*
   supervisor object and its socket client (simulates SIGKILL of the daemon —
   the runner is a separate OS process and keeps going), build a fresh daemon
   + supervisor over the same `AEOS_HOME`, `adoptOrphans()` → session
   re-adopted, transcript contains every numbered line exactly once.

*Accept (ROADMAP): start session, SIGKILL daemon, restart daemon, session re-adopted with no event loss (ring buffer replay).*
Commit: `feat(runner): supervisor with boot-time re-adoption [AEOS-P1.M3.T3]`

### Task 4: Session state machine enforcement  `[AEOS-P1.M3.T4]`

**Files:** `src/supervisor/session-state.ts`, `test/session-state.test.ts`

1. Every transition goes through contracts' `assertSessionTransition`;
   illegal transition → typed error, state untouched.
2. Each accepted transition: atomic `session.yaml` rewrite (M2 codecs) +
   `session.state_changed` event on the bus + index upsert — one code path,
   used by supervisor and (later) scheduler.
3. Tests: full legal path `created→starting→running→completed`; illegal jumps
   rejected; `session.yaml` state equals in-memory state after every step
   (read file back each time); events emitted in order.

*Accept (ROADMAP): illegal transitions rejected; state persisted in `session.yaml` on every change.*
Commit: `feat(runner): enforced session state machine with persisted transitions [AEOS-P1.M3.T4]`

## Milestone exit gate (ROADMAP M3)

> the M3.T3 re-adoption integration test is green in CI.

At exit: flip M3 `[x]`, run R5 drift scan, close the sprint, write the M4
plan (Claude Code provider — spec §9).
