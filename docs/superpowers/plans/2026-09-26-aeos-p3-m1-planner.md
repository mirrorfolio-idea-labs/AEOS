# AEOS P3.M1 — Planner Task Classes

## Design

- **Contracts (additive):**
  - `TASK_CLASSES` covers the nine spec §13 classes plus `verify`, the
    first-class verification task type (spec §12).
  - `PlanTask.taskClass` defaults to `implement`.
  - `PlanTask.agent?` supports P3.M5 delegation.
  - `Checkpoint.verification?` holds the P3.M3 outcome.
  - A new policy tier `run_plan`. `TOOL_TIERS` stays the nine spec §11 tool
    tiers; Codex approval flags only consider `TOOL_TIERS`.
- **Grammar:** `- [ ] **T1** [class] @agent title`. Only non-default classes
  are serialized, so pre-P3 plans round-trip byte-identically (the property
  test still passes).
- **Planner** (`scheduler/src/planner.ts`):
  - `composePlanningPrompt` builds a prompt that starts with
    `PLANNING_MARKER` and asks for grammar lines only.
  - `extractPlanTasks` pulls task lines out of prose. It resets status,
    rejects duplicates, and never accepts `verify` from the model.
  - `interleaveVerify` is used by M3.
  - `generatePlan` runs one session and collects the assistant text.
- **Flow** (`api/routes/objectives.ts` `planIfNeeded`):
  1. `autoPlan: true` creates an objective with a tasks-free `plan.md`.
  2. On start, the planner runs **read-only**: `read_files` is allowed and
     every other tier is *denied*, not parked. This was found when a
     default-posture planner parked on its own bash call.
  3. The result goes to `plan.proposed.md`.
  4. `run_plan` then decides:
     - `allow`: promote the plan and run it.
     - `deny`: the plan stays proposal-only.
     - `confirm` (default posture): an approval in the shared inbox with a
       7-day window.
  5. `POST /objectives/:id/plan/approve` promotes a plan by hand.
  6. Resume-on-boot re-requests a proposal left waiting.
- **Fake model:** `FakeScript.respond(prompt)` injects an assistant reply.
  The aeosd fake and the Playwright harness answer planning prompts with a
  deterministic classed plan.
- **Harness model flag:** `SpawnOptions.model` maps to `--model` on
  Claude, Codex and OpenCode, ahead of the M2 router.
- **Surfaces:**
  - SDK: `approvePlan`, `autoPlan`, `PlanTaskView`.
  - CLI: `objective create --auto-plan` and `objective approve-plan`.
  - ADE: a Planner checkbox, a proposed-plan card, and class badges.

## Verification

- `scheduler/test/planner.test.ts`: grammar, prompt, extraction, interleave,
  and the accept test "provider-fake yields a valid classed plan".
- `api/test/planning.test.ts`: confirm → inbox → approve → runs; deny →
  manual approve; allow → unattended; the default posture never parks the
  planner.
- ADE Playwright T9: auto-plan → proposal card → run_plan approval →
  execution → class badges.
- **Exit gate:** a generated plan executes end to end on provider-fake
  (planning tests and T9).
