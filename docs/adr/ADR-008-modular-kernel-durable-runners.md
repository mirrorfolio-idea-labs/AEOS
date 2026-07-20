# ADR-008 — Shape: Modular Kernel + Durable Session Runners (D7)

- **Status:** accepted
- **Date:** 2026-07-12 (decision), documented 2026-07-20 at P1 exit

## Context

Two shapes were on the table: (A) one daemon process with
in-process modules, session work done by separately-supervised OS
processes; (B) a microservice mesh from day one. Extracting services too
early adds operational cost (deployment, discovery, versioning) before
there's evidence of a scaling need.

## Decision

**Shape A.** `aeosd` is one daemon composed of lifecycle modules (home
layout, index-db, event bus, supervisor, API — `apps/aeosd/src/daemon.ts`)
that start/stop/health-check uniformly (`@aeos/kernel`'s
`createKernel`). Session work happens in **separately supervised OS
processes** (`packages/runner`) that survive daemon restarts and are
re-adopted by session ID over a framed Unix-socket protocol
(`packages/runner`'s wire protocol, M3).

## Consequences

- Sessions outlive daemon crashes and upgrades — proven by the M3
  re-adoption test and generalized by the M9 golden-path E2E (the daemon
  itself can be `kill -9`'d and the *objective* still resumes correctly
  because state is file-derived, independent of whether a runner
  happened to survive).
- Replaceable modules in one process keep operational cost low for a
  local-first, single-user v0.1–v0.4 target.
- Extraction to real services is deferred until scale evidence exists
  (spec §17.7 notes Postgres-swap and TCP-runner-transport as the
  concrete escape hatches, tracked as P4.M4 and backlog item B4) — this
  ADR is the record that the mesh was considered and deliberately not
  built yet.
