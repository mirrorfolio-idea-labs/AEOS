# Epic Register

Epics are the five phases from `docs/ROADMAP.md`. This file adds the PM
attributes (objective, priority, ownership, version target); scope, tasks and
exit gates stay in the ROADMAP — follow the links.

| Epic | Objective (why it exists) | Version | Priority | Owner | Status | Milestones |
|---|---|---|---|---|---|---|
| **P1 — Spine** | Prove the core loop: durable agents that survive daemon death and resume from checkpoints, all state as files. [Scope](../ROADMAP.md#phase-p1--spine-v01) | v0.1 | P0 | Kabeer | `[~]` (M1 done, M2 next) | M1–M9 |
| **P2 — Safety + polish** | Make it safe to leave running: policy tiers, approvals, budgets, audit, secrets, curator, PTY takeover, 3 harnesses, managed binaries, desktop app. [Scope](../ROADMAP.md#phase-p2--safety--polish-v02--) | v0.2 | P1 | Kabeer | `[ ]` | M1–M8 |
| **P3 — Autonomy** | Make it smart: planner task classes, cost-aware routing, verification gates, self-learning retrospectives, wakeups, delegation. [Scope](../ROADMAP.md#phase-p3--autonomy-v03--) | v0.3 | P2 | Kabeer | `[ ]` | M1–M5 |
| **P4 — Scale + community** | Make it portable and extensible: Docker sandbox tier, public plugin API, deploy targets, TCP transport + K8s. [Scope](../ROADMAP.md#phase-p4--scale--community-v04--) | v0.4 | P3 | Kabeer | `[ ]` | M1–M4 |
| **P5 — v1.0 public release** | Ship it to the world: OSS readiness, docs site, CI-only release engineering, public beta, GA launch. [Scope](../ROADMAP.md#phase-p5--v10-public-open-source-release--) | v1.0 | P1 for M1–M2 (parallelizable docs/legal), P4 for M4–M5 | Kabeer | `[ ]` | M1–M5 |

Post-v1 items (direct-API providers, multi-user RBAC, Windows-native runner,
Postgres swap) are held in the [ROADMAP backlog](../ROADMAP.md#post-v1-backlog-tracked-deliberately-out-of-v1-scope)
— they are promoted only by an explicit ROADMAP commit.

Design authority for all epics: the
[architecture spec](../superpowers/specs/2026-07-12-aeos-architecture-design.md)
(§19 explains the drift-resistant decomposition these epics follow).
