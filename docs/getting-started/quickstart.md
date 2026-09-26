# Quickstart

AEOS runs coding agents that never lose their place. An agent's memory, plan
and progress are plain files, so a crash, a reboot or a daemon upgrade
resumes exactly where the work stopped.

This page gets AEOS running on your machine in about five minutes. You don't
need a model account yet.

## 1. Install

You need **Node.js 22** and **git**. pnpm comes with Node through `corepack`.

```bash
git clone https://github.com/mirrorfolio-idea-labs/AEOS.git
cd AEOS
corepack enable
pnpm install
pnpm build
```

## 2. Start the daemon

To look around without a model account, use the built-in demo provider. It
streams realistic output instantly and costs nothing:

```bash
AEOS_PROVIDER=fake node apps/aeosd/dist/main.js run
```

With an Anthropic API key, agents do real work:

```bash
ANTHROPIC_API_KEY=sk-ant-... node apps/aeosd/dist/main.js run
```

State lives in `~/.aeos`. Set `AEOS_HOME` to put it somewhere else.

## 3. Open the web UI

Go to **http://127.0.0.1:7777**. In the web UI:

1. Create a workspace.
2. Add an agent to it.
3. Give the agent an objective.
4. Watch the objective's output stream.

## 4. The whole point, in one step

While an objective is running, kill the daemon (`Ctrl-C`, or `kill -9`) and
start it again. The objective continues from its last checkpoint. No
progress is lost and nothing needs re-explaining.

## Next

- [Your first agent](../first-agent/): a complete walkthrough from the
  terminal covering a real repository, planning, approvals, review and
  memory.
- [Deploy](../../guides/deploy/): run AEOS as a login service, with Docker
  Compose, or on Kubernetes.
