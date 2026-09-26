# AEOS 1.0: coding agents that don't forget where they were

Coding agents are good now. What they can't do is *persist*.

A session crashes, the laptop sleeps, or you close the terminal, and the
work in progress is gone. Worse, so is the context: what was tried, what
failed, what the codebase's conventions are, what you told it last week.
The next session starts from zero and re-learns everything, and you pay
for that in tokens and in patience.

**AEOS makes the agent, not the chat, the durable thing.** It is an
open-source daemon that runs Claude Code, Codex and OpenCode as persistent
workers. Everything an agent knows and is doing lives as plain files you
can read, back up and grep:

- memory
- plans
- checkpoints
- transcripts

Kill the daemon mid-task with `kill -9`, start it again, and the objective
continues from its last checkpoint.

## What you get in 1.0

- **Objectives, not prompts.** You describe a goal. The agent writes a plan
  with task classes (architecture, implementation, review, and so on),
  works through it in its own git worktree, and commits each task under
  its own name. It never touches your checkout.
- **Checks that gate progress.** Your test and lint commands run after
  every code task. A failure goes back to the agent with the output
  attached; three strikes and the plan stops and waits for you.
- **Least privilege by default.** Anything beyond reading and writing its
  worktree has to be approved. That includes running commands, pushing
  and installing packages, and each request waits in an approvals inbox
  in the web UI or the CLI. Budgets are hard caps enforced by the daemon,
  and secrets never reach transcripts.
- **Container sandbox tier.** Put implementation tasks in a container that
  can see only the worktree. The policy is chosen per task class.
- **It learns.** After each objective, failed checks, re-done tasks and
  your review comments become proposed lessons and preferences. Accept
  them, and every future session starts with them.
- **Cost-aware routing.** Frontier models plan and review, cheaper models
  implement, and small models summarize. Every routing decision and its
  actual cost is recorded.
- **It works while you sleep.** Scheduled objectives survive restarts, and
  a run missed while the machine was off fires once when it comes back.
- **Run it anywhere:**
  - `aeos service install` (systemd or launchd)
  - `docker compose up`
  - a Helm chart
  - signed, self-contained release bundles that need only git
- **Extend it.** Providers are npm plugins. Each runs in its own process,
  so a crash takes down only its own session. `npx create-aeos-plugin`
  gives you a working one.

## Try it

```bash
# download a signed bundle from the Releases page, or:
git clone https://github.com/mirrorfolio-idea-labs/AEOS && cd AEOS
corepack enable && pnpm install && pnpm build
AEOS_PROVIDER=fake node apps/aeosd/dist/main.js run   # no model account needed
# open http://127.0.0.1:7777
```

The docs site walks through a first agent end to end, and every command
in that tutorial runs in CI.

AEOS is MIT-licensed. Issues labelled `good first issue` are real,
scoped, and have pointers inside.

---
**Evidence behind each claim** (check before publishing):
- kill -9 resume: `apps/aeosd/test/golden-path.e2e.test.ts` (10× in CI)
- worktree + agent-authored commits: `packages/api/test/worktrees.test.ts`
- verify gating / 3 strikes: `packages/api/test/verify.test.ts`
- least privilege, budgets, no secret leaks: `apps/aeosd/test/p2-exit.e2e.test.ts`, `canary-leak.e2e.test.ts`
- container escape canary: `apps/aeosd/test/sandbox-container.e2e.test.ts`
- learning loop: `apps/aeosd/test/p3-exit.e2e.test.ts`
- restarts / missed cron: `apps/aeosd/test/wakeup-restart.e2e.test.ts`
- plugin crash isolation: `apps/aeosd/test/plugin-crash.e2e.test.ts`
- deploy targets: CI jobs `compose-quickstart`, `nightly-k8s`
- signed bundles: `release.yml`
- tutorial runs in CI: `apps/cli/test/tutorial.test.ts`
