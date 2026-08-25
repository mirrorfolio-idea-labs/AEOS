# AEOS P2.M1 — Policy Engine + Approvals Inbox Implementation Plan

> **For agentic workers:** execute task-by-task, in order. Steps use checkbox
> (`- [ ]`) syntax. Every task ends with the full green bar before its commit:
> `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`.

**Goal:** `@aeos/policy` — permission tiers with layered YAML (workspace →
agent → objective, most-specific wins), compiled to harness-native flags AND
enforced daemon-side (defense in depth), plus the approval flow
(`approval.request` → `waiting_approval` → approve/deny/timeout-deny) exposed
through the API and an ADE inbox.

**Architecture:** spec §11 + §5. New package `packages/policy` sits beside
kernel/memory: imports `@aeos/contracts` only; api/scheduler/ade consume its
published entry point. Tier→mode data and the compiled-policy wire shape live
in **contracts** (they cross the runner framed protocol), so contracts grows a
domain file and regenerated JSON Schemas this milestone.

**Tech Stack:** unchanged — Node ≥22 ESM (`NodeNext`: relative imports need
`.js`), strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
Vitest 2, Zod 3. No new third-party dependencies.

**Spec:** `docs/superpowers/specs/2026-07-12-aeos-architecture-design.md` §11
· **Roadmap IDs:** `AEOS-P2.M1.T1`–`T5`

## Global Constraints

- Conventional commits; the completing commit ends with the task ID and flips
  that ROADMAP checkbox in the same commit.
- Contracts stays the dependency root; `packages/policy` may import only
  `@aeos/contracts`. Never import another package's `src/`.
- After touching any contract schema: `pnpm -F @aeos/contracts gen:schemas`
  and commit the regenerated output (drift test enforces it).
- Files ≤800 lines; TDD order per step (failing test → implement → green).
- Policy YAML files are plain files under the owning scope (files are truth):
  - workspace layer: `<AEOS_HOME>/workspaces/<ws>/policy.yaml`
  - agent layer: `<AEOS_HOME>/workspaces/<ws>/agents/<agent>/policy.yaml`
  - objective layer: `<objectiveDir>/policy.yaml`
  All three are OPTIONAL; absence = inherit the next layer up; no files at
  all = the default posture below.

### Default posture (spec §11, pinned here for tests)

```
read_files: allow        write_files: allow        # read-only + worktree-write
execute_commands: confirm    install_packages: confirm    git_commit: confirm
git_push: confirm            deploy: confirm              secrets_access: confirm
network_access: confirm      # …and confirm-everything-else
confirmTimeoutSeconds: 300   # deny-by-default on expiry
```

---

### Task 1: Policy schemas + layered loader/merger  `[AEOS-P2.M1.T1]`

**Files:**
- Create: `packages/contracts/src/domain/policy.ts`
- Modify: `packages/contracts/src/index.ts`; golden fixture
  `packages/contracts/test/fixtures/events.golden.ndjson` (+2 event types);
  `scripts/gen-schemas.ts` (+1 schema)
- Create: `packages/policy/package.json`, `tsconfig.json`, `src/index.ts`,
  `src/merge.ts`, `src/load.ts`
- Tests: `packages/contracts/test/policy.test.ts`,
  `packages/policy/test/merge.test.ts`, `packages/policy/test/load.test.ts`

**Interfaces (exact names later tasks import):**
- contracts: `PERMISSION_TIERS` (the nine spec §11 tiers, in order),
  `PolicyModeSchema` (`allow|confirm|deny`), `PolicyFileSchema`
  (`{ tiers?: Partial<Record<Tier,Mode>>; confirmTimeoutSeconds?: number }`,
  `.strict()`), `EffectivePolicySchema` (same shape, all tiers total +
  required timeout), type `EffectivePolicy`; NEW event types
  `approval.resolved` (`{requestId, decision:'approved'|'denied'|'expired', by}`) and
  `policy.blocked` (`{tier, tool, detail}`) appended to the taxonomy;
  `policy.schema.json` added to generated schemas.
- policy: `DEFAULT_POSTURE: EffectivePolicy`;
  `mergePolicyLayers(layers: Array<PolicyFile | undefined>): EffectivePolicy`
  (later layers win per key; unspecified tiers inherit earlier layers, then
  defaults); `loadPolicyStack(readYaml) => EffectivePolicy` where
  `readYaml(path) => Promise<object|undefined>` — takes the reader as a
  parameter so daemon wiring and tests inject their own resolution.

**Steps:**

- [ ] **Step 1 (RED):** contracts test parses a `policy.yaml` fixture,
  rejects unknown tier names / unknown modes / stray keys; taxonomy golden
  gains one line each for `approval.resolved` and `policy.blocked`
  (exhaustiveness test forces fixture+schema to move together).
- [ ] **Step 2:** implement contracts domain file; export from index; add
  `'policy': PolicyFileSchema` to `gen-schemas.ts`; run
  `pnpm -F @aeos/contracts gen:schemas`; green.
- [ ] **Step 3 (RED):** policy merge tests — empty stack → exactly the
  default posture; `[ws]` → ws over defaults; `[ws, agent]` → agent wins
  tier-by-tier while untouched tiers keep ws values; objective layer wins on
  conflict; `confirmTimeoutSeconds` most-specific-wins; invalid mode throws.
- [ ] **Step 4:** implement `merge.ts` (pure); scaffold package.json/tsconfig
  copying `packages/memory`'s shape (deps: `@aeos/contracts` workspace:*, yaml).
- [ ] **Step 5 (RED):** load tests write temp AEOS_HOME trees (0–3 layers)
  via fs and assert merged results; missing files skipped silently.
- [ ] **Step 6:** implement `load.ts`; `pnpm install` (new workspace member),
  green locally.
- [ ] **Step 7:** full green bar; commit
  `feat(policy): permission-tier schemas + layered loader/merger [AEOS-P2.M1.T1]`
  (flip ROADMAP T1 → `[x]`, M1 header → `[~]`; include regenerated schemas).

---

### Task 2: Compiler → harness-native flags  `[AEOS-P2.M1.T2]`

**Files:**
- Create: `packages/contracts/src/domain/compiled-policy.ts` (wire shape),
  modify `index.ts`, regenerate schemas
- Create: `packages/policy/src/classify.ts`, `src/compile.ts`
- Tests: `packages/policy/test/classify.test.ts`, `compile.test.ts` (golden)

**Interfaces:**
- contracts: `CompiledPolicySchema = { effective: EffectivePolicySchema;
  native: Record<'claude-code'|'codex'|'opencode', NativeFlags|undefined> }`
  where `NativeFlags = { argv: string[]; env: Record<string,string> }` —
  this is what `SpawnOptions` (provider-core) and the runner protocol carry.
- classify: `classifyToolCall(tool: string, input: unknown): Tier` —
  conservative table: Read/Grep/Glob/LS→`read_files`; Edit/Write/MultiEdit/
  NotebookEdit→`write_files`; Bash→ sub-classify `input.command`:
  `npm|pnpm|yarn|pip|cargo … install/add` →`install_packages`;
  `git push` →`git_push`; `git commit` →`git_commit`;
  `curl|wget|ssh|scp|nc` →`network_access`; anything else →
  `execute_commands`; WebFetch/WebSearch→`network_access`; unknown tool →
  `execute_commands` (fail-closed). Sub-classification is prefix/word-boundary
  matching on the first command segment only — documented, golden-tested.
- compile: `compilePolicy(effective: EffectivePolicy): CompiledPolicy` —
  Claude Code flags: deny tiers → `--disallowedTools` entries; confirm tiers
  → omit from allowedTools + rely on daemon gate (harness prompt is best-
  effort; daemon is authoritative); `allow` write/read → default posture argv.
  Codex: `--sandbox read-only|workspace-write|full-auto` derived from
  write/exec/git_commit allow-ness + `approval_policy=on-request|on-failure|
  never`. OpenCode: env-based `AEOS_POLICY_JSON` passthrough of effective
  tiers (its native model is config-file based; daemon enforcement carries).

**Accept mapping (goldens pin these byte-for-byte):**
one golden per (tier × harness) transition: flipping one tier's mode changes
exactly the expected flag(s) and nothing else.

- [ ] **Step 1 (RED)** classify table tests incl. fail-closed unknowns and
  command sub-classification goldens.
- [ ] **Step 2** implement `classify.ts`.
- [ ] **Step 3 (RED)** compile goldens: default posture ×3 harnesses; then a
  matrix flipping each tier to each mode asserting exact argv diffs.
- [ ] **Step 4** implement `compile.ts` + contracts wire type + regen.
- [ ] **Step 5:** green bar; commit
  `feat(policy): tool-call classification + harness flag compiler [AEOS-P2.M1.T2]`.

---

### Task 3: Daemon-side enforcement at the session boundary  `[AEOS-P2.M1.T3]`

**Files:**
- Create: `packages/policy/src/guard.ts`
- Modify: `packages/provider-core/src/adapter.ts` (`SpawnOptions.permissionPolicy?:
  CompiledPolicy`), provider-core index exports; scheduler spawn site passes
  the compiled policy through when provided
- Modify: `packages/api/src/server.ts` — objective/session start paths wrap
  adapter event streams in the guard; registry of pending approvals lives in
  API context; new routes module `routes/approvals.ts`:
  `GET /v1/approvals` (pending list) · `POST /v1/approvals/:requestId`
  `{decision:'approve'|'deny'}` (404 unknown/expired)
- Tests: `packages/policy/test/guard.test.ts`,
  `packages/api/test/enforcement.test.ts`

**Guard semantics (pin these):**
- Wraps `AsyncIterable<AeosEvent>` → guarded iterable. For each
  `item.tool_call`: tier = `classifyToolCall(...)`; `allow` → pass through;
  `deny` → suppress the call, yield synthetic `item.tool_result`
  `{callId, ok:false, output:'blocked by policy: <tier>'}` AND emit
  `policy.blocked`; `confirm` → emit `approval.request`
  `{requestId, action:<tier>, detail, expiresAt}`, yield nothing further until
  resolved (approved → re-yield the original tool_call; denied/expired →
  same as deny path), registering the pending request in the shared
  `ApprovalsRegistry` injected by the daemon.
- Registry v0 is in-memory in the API context (durable record = the emitted
  events in transcript.ndjson; crash ⇒ session orphans and restart re-guards
  from scratch — consistent with "re-enter the plan" recovery).
- Accept criterion exercise: a FakeAdapter script containing a denied-tier
  `item.tool_call` runs to completion with the call blocked even though the
  harness-native argv (compiled from a deliberately permissive policy handed
  to the fake) says allow — proving defense-in-depth.

- [ ] **Step 1 (RED)** guard unit tests: allow/deny/confirm paths, ordering,
  expiresAt honored (inject clock), resolve() unblocks the iterator.
- [ ] **Step 2** implement `guard.ts` (+ `ApprovalsRegistry` type exported
  from policy: `{request(sessionId,tier,detail,expiresAt): Promise<'approved'|'denied'>,
  resolve(requestId,decision), pending()}`).
- [ ] **Step 3** extend `SpawnOptions`; scheduler passes through.
- [ ] **Step 4 (RED)** API integration test: start objective against a fake
  script with a `git push` tool_call under default posture → blocked result
  visible in events; with `git_push: allow` layer file → passes through.
- [ ] **Step 5** wire server.ts + approvals routes; OpenAPI regenerated.
- [ ] **Step 6:** green bar; commit
  `feat(policy): daemon-side enforcement + approvals endpoints [AEOS-P2.M1.T3]`.

---

### Task 4: Approval flow end-to-end incl. timeout→deny  `[AEOS-P2.M1.T4]`

**Files:**
- Modify: `apps/aeosd/src/api-module.ts` (construct guard+registry once per
  daemon; hand registry to API context; guard wraps every session stream)
- Test: `apps/aeosd/test/approval-flow.e2e.test.ts` (daemon-level)

**Scenarios (all must pass in ONE integration test file):**
1. **confirm→approve:** fake session hits confirm-tier tool_call → daemon
   emits `approval.request`, session state reaches `waiting_approval` (via
   existing legal transition running→waiting_approval), POST approve →
   session resumes, tool executes, objective completes.
2. **confirm→deny:** second session same setup → POST deny → tool blocked,
   session continues/fails per script, `approval.resolved{denied}` in stream.
3. **expiry:** registry constructed with `confirmTimeoutSeconds: 1` (injected
   clock/short timeout via test option) → no answer posted → auto-deny after
   ~1s, `approval.resolved{expired}`, identical downstream effects to deny.

- [ ] **Step 1 (RED)** write the three scenarios against a scripted fake
  with paceMs pacing and real HTTP calls to the bound daemon.
- [ ] **Step 2** wire api-module; make timeouts injectable
  (`ApiModuleConfig.approvalTimeoutSeconds?`).
- [ ] **Step 3:** green bar (suite now includes new e2e; watch runtime —
  keep total added wall time ≤15s); commit
  `feat(aeosd): approval flow end-to-end with timeout-deny [AEOS-P2.M1.T4]`.

---

### Task 5: ADE approvals inbox + notification hook  `[AEOS-P2.M1.T5]`

**Files:**
- Regenerate SDK from updated OpenAPI (existing pipeline).
- Modify: `apps/ade/src` — inbox panel component listing pending approvals
  (requestId, tier/action, detail, age) with Approve/Deny buttons; badge/toast
  on live `approval.request` SSE events (v0 notification hook); poll
  `GET /v1/approvals` on mount + after actions.
- Test: `apps/ade/test/approvals.spec.ts` (Playwright)

**Accept:** Playwright drives a daemon whose fake script triggers a confirm
tool_call: inbox shows the request; clicking Approve lets the session
complete (state visible in UI); a second run clicks Deny and the UI reflects
the blocked outcome.

- [ ] **Step 1 (RED)** Playwright spec against dev daemon fixture.
- [ ] **Step 2** implement panel + SSE badge; SDK client method additions.
- [ ] **Step 3:** FULL green bar + `pnpm -F @aeos/ade test` twice; commit
  `feat(ade): approvals inbox + notification hook [AEOS-P2.M1.T5]`.

---

## Exit gate (P2.M1)

All five checkboxes `[x]` + the end-to-end posture proof green: a fresh agent
with ZERO policy files on disk gets the default posture; a fake objective
whose script contains a `git_push` tool_call is BLOCKED daemon-side; adding
an agent-layer `policy.yaml` with `git_push: allow` lets the identical
objective complete; a confirm-tier action produces an approvable request
whose expiry denies by default. Then: flip the milestone marker, run the R5
drift scan, close S05, regenerate BOARD/TRACEABILITY, and only then author
P2.M2's plan (just-in-time rule).
