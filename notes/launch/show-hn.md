**Title:** Show HN: AEOS – run Claude Code/Codex as durable agents whose state is plain files

**Text:**

Hi HN. AEOS is a daemon that turns coding agents (Claude Code, Codex,
OpenCode) from chat sessions into persistent workers.

Everything an agent has is a file on disk: its memory, plan, checkpoints
and transcript. So a crash or a reboot doesn't lose anything. You can
`kill -9` the daemon in the middle of a task and it picks up at the last
checkpoint. That test runs 10 times in CI.

Beyond persistence it does the boring things you need before letting an
agent run unattended:

- It works in its own git worktree.
- Anything beyond editing that worktree needs your approval.
- Budgets are enforced by the daemon, not by the model.
- Your test commands gate progress, and there's an optional container tier.
- There's a small learning loop: your review comments become preferences
  that later sessions start with.

It's local-first: a web UI on localhost, a CLI, and a Tauri desktop shell.
You can also run it as a service, in docker compose or on Kubernetes. It's
MIT licensed.

It's written in TypeScript. I'd especially like feedback on:

- the files-as-truth design (ADR-006 in the repo);
- the plugin boundary: providers run out of process, and the host
  validates every event.

Repo: https://github.com/mirrorfolio-idea-labs/AEOS
Docs: https://mirrorfolio-idea-labs.github.io/AEOS/

(You can try it with no API key: `AEOS_PROVIDER=fake` runs a scripted
demo agent.)
