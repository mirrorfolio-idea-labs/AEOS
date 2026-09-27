## What

<!-- One paragraph: what this PR does and why. -->

## Task / issue

<!-- Roadmap task ID if applicable, e.g. AEOS-P1.M4.T1, and the issue it closes. -->

Closes #

## Checklist

- [ ] CI-identical chain green locally: `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`
- [ ] Tests cover the acceptance criteria (tests written first where feasible)
- [ ] Commits follow conventional format; task-advancing commits end with the task ID
- [ ] If this completes a roadmap task: its checkbox in `docs/ROADMAP.md` is flipped in the completing commit (PM rule R1)
- [ ] If schemas changed: `pnpm -F @aeos/contracts gen:schemas` output committed
- [ ] Docs follow the change (PM rule R2): user-facing behavior changes update `docs/`/README in this PR; CLI or API surface changes regenerate `docs/reference/` (`pnpm -F @aeos/cli gen:reference`, `pnpm -F @aeos/api gen:openapi && pnpm -F @aeos/api gen:reference`)
- [ ] No secrets, tokens, or machine-local paths introduced
