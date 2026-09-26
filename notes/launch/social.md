## X / Bluesky thread

1/ AEOS 1.0 is out: open-source infrastructure that runs Claude Code, Codex
and OpenCode as *durable* agents. The agent, not the chat, is the thing
that persists. 🧵

2/ Every agent's memory, plan, checkpoints and transcript are plain files.
kill -9 the daemon mid-task, restart it, and it continues from the last
checkpoint. We test that 10× in CI.

3/ It's safe to leave unattended:
- each task runs in its own git worktree
- anything beyond editing that worktree needs your approval
- budgets are enforced by the daemon
- your tests gate progress
- implementation can run in a container that only sees the worktree

4/ It learns. Your review comments and failed checks become lessons that
the agent's next sessions start with.

5/ Run it on your laptop as a login service, with docker compose, or on
Kubernetes. Or download a signed bundle that needs only git. Try it with
no API key: AEOS_PROVIDER=fake.

6/ It's MIT licensed. Good first issues are waiting:
https://github.com/mirrorfolio-idea-labs/AEOS

## LinkedIn (short)

We've open-sourced AEOS 1.0. It runs AI coding agents as durable workers
whose entire state lives as files:

- they survive crashes and reboots
- they work in isolated git worktrees
- anything risky needs a human's approval
- they learn from code review

It runs on a laptop, in Docker or on Kubernetes. MIT licensed.
https://github.com/mirrorfolio-idea-labs/AEOS

## Reddit (r/ClaudeAI · r/LocalLLaMA · r/programming): adapt the title per sub

**Title:** I built an open-source daemon that runs Claude Code / Codex as
persistent agents. You can kill -9 it mid-task and it resumes.

**Body:** Use the Show HN text, with the "feedback I'd like" paragraph at
the top. On r/LocalLLaMA, lead with the plugin API ("add your own local
model provider as an npm plugin; it runs out-of-process"). Be honest there
that the built-in providers wrap hosted harnesses today.
