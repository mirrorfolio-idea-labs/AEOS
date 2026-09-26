# Seeded good-first issues (P5.M4.T2)

These are the source text for the issues labelled `good first issue`. Each
one is a real gap, checked against the code on 2026-09-26, with pointers
and a clear definition of done. When an issue closes, strike it through
here with the PR link.

---

## 1. `aeos workspace list` and `aeos agent list` — [#134](https://github.com/mirrorfolio-idea-labs/AEOS/issues/134)
**Labels:** good first issue · enhancement · area:cli

The web UI lists workspaces and agents, but the CLI can only create them.
The API endpoints (`GET /v1/workspaces`, `GET /v1/agents?workspaceId=`)
and the SDK (`listWorkspaces`) already exist.

- **Where:** `apps/cli/src/cli.ts` (see how `aeos inbox` prints rows) and
  `packages/sdk/src/client.ts` (add `listAgents(workspaceId)` if it is
  missing).
- **Done when:** both commands print one row per item. `apps/cli/test/`
  covers them against the in-process API server, as
  `golden-path.test.ts` does. The usage text lists them.

## 2. List an agent's objectives (`GET /v1/objectives` + `aeos objective list`) — [#135](https://github.com/mirrorfolio-idea-labs/AEOS/issues/135)
**Labels:** good first issue · enhancement · area:api · area:cli

You can create objectives and check one objective's status, but you
can't list them.

- **Where:** `packages/api/src/routes/objectives.ts`. Objectives live
  under `<agent>/objectives/<id>/`; reuse the status reader. Then
  `packages/sdk/src/client.ts` and `apps/cli/src/cli.ts`.
- **Done when:** the endpoint returns id, title, running and task counts.
  Run `pnpm -F @aeos/api gen:openapi` and `pnpm -F @aeos/sdk gen:types`
  and commit the output (CI checks for drift). The CLI prints a table,
  and there are tests for each layer.

## 3. `--json` output for listing commands — [#136](https://github.com/mirrorfolio-idea-labs/AEOS/issues/136)
**Labels:** good first issue · enhancement · area:cli

`aeos inbox`, `aeos approvals`, `aeos job list` and `aeos plugin list`
print human-readable text, which is awkward in scripts.

- **Where:** `apps/cli/src/cli.ts`. `parseArgs` already gives you
  `parsed.flags`.
- **Done when:** each of those commands prints JSON (one array) when given
  `--json`, and a test parses that output.

## 4. `aeos doctor` — [#137](https://github.com/mirrorfolio-idea-labs/AEOS/issues/137)
**Labels:** good first issue · enhancement · area:cli

Newcomers hit the same setup problems: git not on `PATH`, Node older than
22, `AEOS_HOME` not writable, the daemon not reachable, a token required
but not set, no docker for the container tier.

- **Where:** a new `runDoctorCommand` in `apps/cli/src/cli.ts`. See
  `dockerAvailable()` in `@aeos/provider-core` for the pattern.
- **Done when:** each check prints ✓ or ✗ with a one-line fix, the command
  exits non-zero when anything is ✗, and it has unit tests (inject the
  probes).

## 5. `aeos job enable|disable <id>` — [#138](https://github.com/mirrorfolio-idea-labs/AEOS/issues/138)
**Labels:** good first issue · enhancement · area:cli · area:scheduler

Jobs have an `enabled` flag (`packages/scheduler/src/wakeups.ts`), and
`POST /v1/jobs` accepts it, but from the CLI you can only delete a job.

- **Where:** `apps/cli/src/cli.ts` (the `job` group) and
  `packages/sdk/src/client.ts` (`saveJob`).
- **Done when:** both commands keep the job's `createdAt` and `lastRunAt`,
  and `aeos job list` shows `(disabled)`. Add a test.

## 6. Scheduled jobs in the web UI — [#139](https://github.com/mirrorfolio-idea-labs/AEOS/issues/139)
**Labels:** good first issue · enhancement · area:ui

Wakeup jobs (cron and idle) are only visible from the CLI.

- **Where:** `apps/ade/src/`. A small card in the agent view, or a
  sidebar section, backed by `client.listJobs()` and `client.deleteJob()`.
- **Done when:** jobs are listed with their schedule, last run and last
  error, and can be deleted. A Playwright test in `apps/ade/test/ade.spec.ts`
  covers it.

## 7. Helm: `podAnnotations`, `podLabels`, `serviceAccount` — [#140](https://github.com/mirrorfolio-idea-labs/AEOS/issues/140)
**Labels:** good first issue · enhancement · area:deploy

These are standard chart knobs that clusters need (Prometheus scraping,
Vault, IRSA/workload identity).

- **Where:** `deploy/helm/aeos/values.yaml` and
  `templates/deployment.yaml`, plus an optional `templates/serviceaccount.yaml`.
- **Done when:** the values render (`helm template`), the `helm-lint` CI
  job is green, and `docs/deploy.md` §4 mentions them.

## 8. Troubleshooting page — [#141](https://github.com/mirrorfolio-idea-labs/AEOS/issues/141)
**Labels:** good first issue · docs · area:docs

Collect the error messages users actually see, each with its fix. Some
examples:

- `refusing to bind … without AEOS_API_TOKEN`
- `missing or invalid bearer token`
- `no provider "…" is registered`
- `policy requires the container sandbox tier`
- a port already in use
- `git` missing

- **Where:** a new `docs/troubleshooting.md`, added to the page map in
  `apps/docs/scripts/sync-docs.mjs`.
- **Done when:** the page covers at least eight errors and
  `pnpm -F @aeos/docs build` stays green (it runs the link check).

## 9. Docs site: a real 404 page — [#142](https://github.com/mirrorfolio-idea-labs/AEOS/issues/142)
**Labels:** good first issue · docs · area:docs

The docs build warns `Entry docs → 404 was not found`.

- **Where:** `apps/docs`. See Starlight's docs on custom 404 pages.
- **Done when:** the warning is gone and the 404 page links back to the
  quickstart.

## 10. `create-aeos-plugin --ts` — [#143](https://github.com/mirrorfolio-idea-labs/AEOS/issues/143)
**Labels:** good first issue · enhancement · area:plugins

The template is plain JavaScript, which keeps it dependency-free. Many
authors would still like a TypeScript starter.

- **Where:** `packages/create-aeos-plugin/`. Add a `template-ts/` with a
  `tsconfig.json`, a `build` script and `@aeos/contracts` as a dev
  dependency for types.
- **Done when:** `create-aeos-plugin my-plugin --ts` scaffolds a project
  that builds and passes the same conformance test as the JS template
  (`test/template-conformance.test.ts`).

## 11. Compose override for the container sandbox tier — [#144](https://github.com/mirrorfolio-idea-labs/AEOS/issues/144)
**Labels:** good first issue · enhancement · area:deploy

`docs/deploy.md` §2 explains what the container tier needs inside compose:
the docker socket, and `AEOS_HOME` mounted at the same path on both
sides. Nothing ships it.

- **Where:** a new `compose.sandbox.yaml`, applied as an override with
  `docker compose -f compose.yaml -f compose.sandbox.yaml up`.
- **Done when:** the override works and is documented in §2, including
  the socket's security warning. Extending `docker/compose-smoke.mjs` to
  cover it is optional.
