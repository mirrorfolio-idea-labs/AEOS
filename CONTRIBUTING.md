# Contributing to AEOS

Thanks for your interest in AEOS — the Autonomous Engineering Operating
System. Every unit of work in this project is tracked as a GitHub issue tied
to a stable roadmap task ID, so contributing is designed to be
self-service: pick an issue, follow its acceptance criteria, open a PR.

## TL;DR

1. Pick an open issue — start with
   [`good first issue`](https://github.com/mirrorfolio-idea-labs/AEOS/labels/good%20first%20issue)
   or anything in the current milestone (see the
   [board](docs/pm/BOARD.md)). Comment on it so it can be assigned to you.
2. Read the issue's **acceptance criteria** — they come verbatim from
   [`docs/ROADMAP.md`](docs/ROADMAP.md), which is the source of truth.
3. Branch, implement (tests first — see below), open a PR that references
   the issue (`Closes #N`) and the task ID.

## Project orientation

| Read this | To learn |
|---|---|
| [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md) | Single-file cold-start onboarding |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | All phases/milestones/tasks + status (the drift anchor) |
| [`docs/superpowers/specs/2026-07-12-aeos-architecture-design.md`](docs/superpowers/specs/2026-07-12-aeos-architecture-design.md) | Full architecture spec |
| [`docs/pm/README.md`](docs/pm/README.md) | PM operating manual (sync rules R1–R6) |
| [`docs/adr/`](docs/adr/) | Architecture decision records |

**Fact-checking rule:** docs describe intent; the code and git history are
the facts. If they disagree, trust the code and open an issue (or PR) fixing
the doc.

## Development setup

Requirements: **Node 22** (`.nvmrc`) and **pnpm 9.15** (via corepack).

```bash
git clone https://github.com/mirrorfolio-idea-labs/AEOS.git
cd AEOS
corepack enable
pnpm install
pnpm build && pnpm test
```

The CI-identical verification chain — run it before every PR:

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise
```

If you touch schemas in `@aeos/contracts`, regenerate and commit the JSON
Schemas: `pnpm -F @aeos/contracts gen:schemas` (CI fails on drift).

## Rules of the codebase

- **Boundaries:** packages may only import each other's published entry
  points — never internals. `pnpm depcruise` enforces this.
- **Tests first:** every task's acceptance criteria are test-shaped. Write
  the failing test, then the implementation (Vitest).
- **Strict TS, ESM only.** No `any` escapes without a comment explaining why.
- **Files as truth:** state lives in files; SQLite holds only derived,
  rebuildable indexes. Don't introduce state that can't be rebuilt from
  files.

## Commits and PRs

- Conventional commits: `feat(runner): framed protocol codec [AEOS-P1.M3.T1]`
  — types: `feat, fix, refactor, docs, test, chore, perf, ci`.
- A commit that advances a roadmap task ends its subject with the task ID.
- The commit that **completes** a task flips its checkbox in
  `docs/ROADMAP.md` in the same commit (PM rule R1), and the PR closes the
  matching issue.
- Keep PRs scoped to one task (or a coherent slice of one) whenever
  possible.

## Reporting bugs and proposing features

Use the issue templates. For anything that changes architecture, expect the
discussion to end in an ADR under `docs/adr/` before code lands.

## Security issues

Do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Response expectations

Maintainers triage new issues and PRs within **3 business days**. Pings are
welcome after that.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
