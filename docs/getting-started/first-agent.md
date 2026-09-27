# Your first agent

This walkthrough drives AEOS from the terminal: an agent works in a real git
repository, plans its own work, stops for your approval, and learns from
your review.

Every command in the <code>tutorial:run</code> blocks below runs in CI against a fresh daemon,
so what you read here is known to work.

Start the daemon in one terminal. Use `AEOS_PROVIDER=fake` for a free dry
run, or set `ANTHROPIC_API_KEY` for real work:

```bash
AEOS_PROVIDER=fake node apps/aeosd/dist/main.js run
```

In a second terminal, point the CLI at it:

```bash
alias aeos="node $PWD/apps/cli/dist/main.js"
export AEOS_API_URL=http://127.0.0.1:7777
```

## 1. A workspace and an agent

A **workspace** groups agents, for example one per client or project. An
**agent** is the durable thing: it keeps its own memory, credentials and
policy across every task you give it.

<!-- tutorial:run -->
```bash
aeos workspace create acme --name "Acme Corp"
aeos agent create dev --workspace acme --name "Dev Agent"
```

## 2. Give it a repository

Agents never touch your checkout. Each objective runs in its own git
**worktree** on its own branch, and every finished task becomes one commit
authored by the agent. `--verify` names the commands that prove the work is
good; AEOS runs them and sends failures back to the agent.

<!-- tutorial:run -->
```bash
aeos repo bind app --workspace acme --agent dev --path "$DEMO_REPO" --verify "test -f README.md"
```

`$DEMO_REPO` is any git repository on your machine, for example
`DEMO_REPO=$PWD`.

## 3. An objective, planned by the agent

Describe the goal. With `--auto-plan`, the agent first writes a classed plan
(architecture, implementation, review and so on) with a verify step after
each code task, then does the work:

<!-- tutorial:run -->
```bash
aeos objective create readme --workspace acme --agent dev --title "Improve the README" --repo app --auto-plan
aeos objective run readme --workspace acme --agent dev --timeout-ms 90000
```

Running a generated plan is a permissioned action, and so is anything else
the agent wants to do beyond its permissions: running commands, pushing,
installing packages. Each one **parks in your approvals inbox**, and
`objective run` prints the request together with the command that answers
it. Answer from a second terminal, or in the web UI's inbox, and the run
continues:

```bash
aeos approvals                       # what is waiting
aeos approvals approve <requestId>   # or: aeos approvals deny <requestId>
```

To let this workspace's agents run plans and commands without asking, put
this in `~/.aeos/workspaces/acme/policy.yaml`:

```yaml
tiers:
  run_plan: allow
  execute_commands: allow
```

## 4. Review like a teammate

See what changed, then leave line comments. They go back to the agent as a
follow-up task.

```bash
aeos objective diff readme --workspace acme --agent dev
aeos objective review readme --workspace acme --agent dev --comment "README.md:1: keep the title short"
```

## 5. It learns

When an objective finishes, a retrospective turns failed checks, re-done
tasks and your review comments into proposed **lessons** and
**preferences**. Accept them, and every future session of this agent starts
with them.

<!-- tutorial:run -->
```bash
aeos memory proposals --workspace acme --agent dev
aeos memory accept --workspace acme --agent dev
```

## 6. Let it work while you sleep

Schedule the objective, or any other, with a cron expression in UTC. Jobs
are files, so they survive restarts, and a run missed while the machine was
off fires once when it comes back.

A scheduled run follows the agent's policy like any other, so a gated action
still parks in the approvals inbox until you answer it. For work that should
finish unattended, allow those actions in the agent's or workspace's
`policy.yaml` ahead of time.

<!-- tutorial:run -->
```bash
aeos job add nightly-readme --cron "0 3 * * *" --workspace acme --agent dev --objective readme
aeos job list
```

## Where to go next

- **Keep it always on:** [Deploy](../../guides/deploy/) covers
  `aeos service install`, Docker Compose, and Kubernetes.
- **See everything at once:** `aeos inbox` sorts every agent by what needs
  you. Blocked agents come first.
- **Stop everything:** `aeos stop --all` is the kill switch. No new session
  starts until `aeos resume-ops`.
- **Extend it:** [Plugins](../../guides/plugins/) add providers without
  touching the core.
