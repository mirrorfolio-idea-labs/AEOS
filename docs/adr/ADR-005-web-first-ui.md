# ADR-005 — UI: Web-First, Daemon-Served, Thin Desktop Wrapper (D4)

- **Status:** accepted
- **Date:** 2026-07-12 (decision), documented 2026-07-20 at P1 exit

## Context

AEOS needs one UI codebase that works for a local daemon on a laptop and,
later, a remotely-hosted daemon reached over the network — without
maintaining two front ends.

## Decision

**ADE is a web app** (React + Vite + Tailwind, shadcn conventions),
served directly by the daemon's Fastify server (`aeosd` mounts
`apps/ade/dist` when present, spec §14). A desktop experience wraps the
same served UI in Tauri (P2.M8) rather than forking a separate
implementation — deep links and native notifications are the only
desktop-specific code.

## Consequences

- One UI codebase covers `localhost:7777` today and a remote/hosted
  daemon later with zero UI changes.
- The UI holds no state the daemon doesn't — it is a pure consumer of the
  OpenAPI + SSE surface (`@aeos/sdk`), which keeps the Tauri wrapper
  genuinely thin.
- Component choice (shadcn-style: cva, Radix primitives, Tailwind) was
  picked specifically because it has no server-rendering coupling and
  packages cleanly inside a Tauri webview.
