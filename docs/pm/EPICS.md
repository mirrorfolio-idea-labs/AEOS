# Epic Register

Epics are the four phases from `docs/ROADMAP.md`. This file adds the PM
attributes (objective, priority, ownership); scope and exit gates stay in the
ROADMAP — follow the links.

| Epic | Objective (why it exists) | Priority | Owner | Status | Milestones |
|---|---|---|---|---|---|
| **P1 — Spine (v0.1)** | Prove the core loop: durable agents that survive daemon death and resume from checkpoints, all state as files. [Scope + exit gate](../ROADMAP.md#phase-p1--spine-v01) | P0 — everything else waits on it | Kabeer | `[~]` (M1 in progress) | M1–M9, see ROADMAP |
| **P2 — Safety + polish** | Make it safe to leave running: policy tiers, budgets, audit, secrets, human takeover. [Scope](../ROADMAP.md#phase-p2--safety--polish--) | P1 | Kabeer | `[ ]` — milestones defined at P1 exit | TBD at P1 exit |
| **P3 — Autonomy** | Make it smart: planner task classes, cost-aware routing, verification, self-learning. [Scope](../ROADMAP.md#phase-p3--autonomy--) | P2 | Kabeer | `[ ]` | TBD |
| **P4 — Scale + community** | Make it shared: sandboxing, plugin API, deploy targets, multi-user. [Scope](../ROADMAP.md#phase-p4--scale--community--) | P3 | Kabeer | `[ ]` | TBD |

Design authority for all epics: the
[architecture spec](../superpowers/specs/2026-07-12-aeos-architecture-design.md)
(§19 explains the drift-resistant decomposition these epics follow).
