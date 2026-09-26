# AEOS P3.M2 — Cost-Aware Model Router

New package `@aeos/router` (spec §5 lists `router/`). It depends on
contracts and kernel only.

## Design

- **Pricing** (`pricing.ts`):
  - `<home>/router/pricing.json` is cached from OpenRouter
    `/api/v1/models`. Per-token strings are converted to per-MTok, and each
    model is indexed under both its vendor id and its bare id. Dynamic
    (`-1`) prices are skipped.
  - It refreshes daily. When the network is down, the stale cache is served
    (`stale: true`); with no cache, the static first-party table is used.
  - `STATIC_PRICING` holds Anthropic list prices (Fable 5.1, Opus 5.5,
    Opus 5, Sonnet 5, Haiku 4.5) and is always merged in.
  - The daemon refreshes unless `AEOS_PRICING_OFFLINE=1` or the fake
    provider is in use. The API default is offline, so tests never hit the
    network.
- **Policy** (`policy.ts`):
  - `routing.yaml` exists at the home level and the workspace level, as
    `default` plus `classes`, mapping to `{provider, model, thinking}`. The
    schema is strict, so typos fail.
  - Precedence is field by field: agent `modelPreferences[class]`, then the
    workspace class entry, the home class entry, the workspace default, the
    home default, and finally the built-in split.
  - The built-in split applies to claude-code only:
    - plan, architect, review and security_review → `claude-opus-5`
      (thinking high);
    - implement and refactor → `claude-sonnet-5`;
    - summarize, docs and rename → `claude-haiku-4-5`.
  - Other harnesses keep their own default model. The IDs and prices come
    from the claude-api reference; Opus 5.5 is priced but is not a default
    because it is still launching.
- **Records** (`records.ts`): `<objective>/routes.ndjson` gets one
  append-only line per task attempt: the decision, the pricing source and
  staleness, and the realized status, USD, token split, and `derivedUsd`
  when the adapter reports tokens only (`costUsd: false`, as Codex does).
- **Wiring:**
  - Contracts gain the `route.decided` event (golden fixture, audited).
  - The scheduler gains `selectExecution(task)` and `onTaskSettled(task,
    {status, usd, tokens})`.
  - `ApiServerOptions.adapterFor(agent, {provider})` and `pricing`.
  - `startObjectiveRun` builds one policy-guarded adapter per provider.
  - The planner session is routed as class `plan`.
  - `GET /v1/objectives/:id/routes`, SDK `objectiveRoutes`, CLI
    `aeos objective routes`.

## Recorded fixture

`test/fixtures/openrouter-models.json` follows OpenRouter's documented
response shape. This build environment's egress policy blocks openrouter.ai
(`connect_rejected`), so the fixture was written by hand. Re-record it from
an unrestricted machine with `pnpm -F @aeos/router record:pricing`.

## Verification

- `router/test/router.test.ts`:
  - fixture parse;
  - refresh then cache hit;
  - **network down → stale-but-served**, and a cold start → static;
  - USD estimate;
  - **the class × policy fixture matrix**;
  - agent-preference precedence and typo rejection;
  - records.
- `api/test/routing.test.ts` (**exit gate**): architect, implement and docs
  tasks reach claude-code, codex and opencode respectively with the
  documented models; `route.decided` appears in the audit; the routes
  endpoint works; a token-priced USD of $3.00 is derived for a tokens-only
  provider.
- Full bar: 402 passed / 2 skipped; Playwright 10/10.
