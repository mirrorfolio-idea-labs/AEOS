# CLI reference

<!-- Generated from the `aeos` usage text by `pnpm -F @aeos/cli gen:reference`.
     Do not edit by hand: CI fails when this page and the CLI disagree. -->

`aeos` is the command-line client for the AEOS daemon. It talks to a running
daemon at `AEOS_API_URL` (default `http://127.0.0.1:7777`); set
`AEOS_API_TOKEN` when the daemon requires a token. The `harness`, `service`
and `sandbox` commands work on this machine directly.

Commands: [`health`](#aeos-health) · [`workspace`](#aeos-workspace) · [`agent`](#aeos-agent) · [`inbox`](#aeos-inbox) · [`approvals`](#aeos-approvals) · [`memory`](#aeos-memory) · [`job`](#aeos-job) · [`repo`](#aeos-repo) · [`objective`](#aeos-objective) · [`events`](#aeos-events) · [`stop`](#aeos-stop) · [`resume-ops`](#aeos-resume-ops) · [`harness`](#aeos-harness) · [`service`](#aeos-service) · [`plugin`](#aeos-plugin) · [`sandbox`](#aeos-sandbox) · [`update`](#aeos-update)

## aeos health

```bash
aeos health
```

## aeos workspace

```bash
aeos workspace create <id> --name <name>
```

## aeos agent

```bash
aeos agent create <id> --workspace <ws> --name <name> [--provider claude-code|codex|opencode|plugin:<id>] [--credential-profile <cp>]
  [--harness-version <pinned>] [--binary-path <byo executable>]
aeos agent switch-credential <id> --workspace <ws> --profile <credentialProfileId>
aeos agent status <id> --workspace <ws>
aeos agent wait <id> --workspace <ws> [--until blocked,done] [--timeout-ms 30000] [--after-seq <n>]
aeos agent seen|unread|settle|unsettle <id> --workspace <ws>
```

## aeos inbox

```bash
aeos inbox               # every agent, attention-sorted (blocked first)
```

## aeos approvals

```bash
aeos approvals [list] | aeos approvals approve|deny <requestId>   # parked actions waiting for you
```

## aeos memory

```bash
aeos memory proposals --workspace <ws> --agent <agent>        # queued lessons/preferences
aeos memory accept [<id>] --workspace <ws> --agent <agent>    # all, or one
aeos memory reject <id> --workspace <ws> --agent <agent>
```

## aeos job

```bash
aeos job add <id> --cron "0 3 * * *" --workspace <ws> --agent <agent> --objective <obj>   # UTC
aeos job add <id> --idle-ms 600000 [--min-interval-ms 3600000] --curator
aeos job list | aeos job rm <id>
```

## aeos repo

```bash
aeos repo bind <id> --workspace <ws> --agent <agent> --path </abs/checkout> [--base-ref main] [--verify "pnpm test" ...]
aeos repo unbind <id> --workspace <ws> --agent <agent>
```

## aeos objective

```bash
aeos objective create <id> --workspace <ws> --agent <agent> --title <title> --task "T1: first" [--task ...]
  [--repo <binding>] [--done "definition of done"] [--verify "cmd" ...]
aeos objective create <id> --workspace <ws> --agent <agent> --title <title> --auto-plan   # planner writes the plan
aeos objective approve-plan <id> --workspace <ws> --agent <agent>
aeos objective routes <id> --workspace <ws> --agent <agent>   # router decisions + realized cost
aeos objective diff <id> --workspace <ws> --agent <agent> [--scope branch|uncommitted|last-commit]
aeos objective review <id> --workspace <ws> --agent <agent> --comment "src/a.ts:12: rename this" [--comment ...]
aeos objective run <id> --workspace <ws> --agent <agent> [--poll-ms 250] [--timeout-ms 120000]
aeos objective status <id> --workspace <ws> --agent <agent>
```

## aeos events

```bash
aeos events tail [--type-prefix session.] [--agent <id>] [--max <n>]
```

## aeos stop

```bash
aeos stop --all          # kill switch: no new sessions spawn; in-flight ones finish
aeos stop status
```

## aeos resume-ops

```bash
aeos resume-ops          # lifts the kill switch
```

## aeos harness

```bash
aeos harness pins        # pinned harness releases of record
aeos harness install <harness>@<version>   # fetch + integrity-check + seal (local, AEOS_HOME)
aeos harness verify <harness>@<version>    # re-hash an install against its seal
aeos harness list
```

## aeos service

```bash
aeos service install [--aeosd <main.js>] [--port 7777] [--host 0.0.0.0 --token-file <f>] [--dry-run]
  # run aeosd as a user service (systemd user unit / launchd agent)
aeos service uninstall | aeos service status
```

## aeos plugin

```bash
aeos plugin install <npm-spec|./plugin.tgz>   # third-party plugin (no install scripts run; restart aeosd to load)
aeos plugin list | aeos plugin remove <package>
```

## aeos sandbox

```bash
aeos sandbox build [--tag aeos-runner:local]   # container-tier runtime image (P4.M1)
aeos sandbox status
```

## aeos update

```bash
aeos update [--version <tag>]   # update an installer (install.sh) install to the latest or given release, verified
```
