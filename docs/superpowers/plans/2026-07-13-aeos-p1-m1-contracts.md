# AEOS P1.M1 — Monorepo Scaffold + Contracts Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the AEOS pnpm monorepo and build `@aeos/contracts` — the schema package every other module depends on (event envelope, domain objects, canonical event taxonomy, exported JSON Schemas, CI boundary enforcement).

**Architecture:** `packages/contracts` is the dependency root of the whole system (spec §5–§6): Zod schemas define every wire contract; JSON Schemas are generated from them and committed (drift-tested in CI); dependency-cruiser forbids cross-package internal imports. Nothing else exists yet — this milestone produces the vocabulary the daemon, runners, providers, and UI will all speak.

**Tech Stack:** Node 22 (ESM, `NodeNext` resolution — **all relative imports need `.js` extensions**), pnpm 9 workspaces, TypeScript 5.6 strict, Vitest 2, Zod 3, `ulid`, `zod-to-json-schema`, dependency-cruiser 16, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-12-aeos-architecture-design.md` · **Roadmap IDs:** `AEOS-P1.M1.T1`–`T6`

## Global Constraints

- Node `>=22`, pnpm `>=9`, `"type": "module"` everywhere, TypeScript `strict: true`.
- `packages/contracts` depends on **nothing** in the workspace; all other packages depend on it; no package imports another package's `src/` internals (dependency-cruiser-enforced).
- Files ≤800 lines; one responsibility per file.
- Conventional commits, task ID suffixed: `feat(contracts): event envelope [AEOS-P1.M1.T2]`.
- Update `docs/ROADMAP.md` status markers (`[ ]`→`[x]`) in the same commit that completes a task.
- Never add `--no-verify` to git commands (repo hook policy blocks it).

---

### Task 1: pnpm monorepo scaffold  `[AEOS-P1.M1.T1]`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `.gitignore`, `tsconfig.base.json`, `vitest.workspace.ts`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`, `packages/contracts/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: workspace commands later tasks rely on: `pnpm test`, `pnpm build`, `pnpm -F @aeos/contracts <script>`; base tsconfig path `tsconfig.base.json` that every package extends.

- [ ] **Step 1: Verify toolchain**

Run: `node --version && pnpm --version`
Expected: Node ≥ v22, pnpm ≥ 9. If pnpm is missing: `corepack enable && corepack prepare pnpm@9 --activate`.

- [ ] **Step 2: Write root workspace files**

`package.json`:
```json
{
  "name": "aeos",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "~5.6.3",
    "vitest": "^2.1.8"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`.npmrc`:
```ini
save-exact=false
strict-peer-dependencies=false
```

`.nvmrc`:
```
22
```

`.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
.aeos/
ruvector.db
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.workspace.ts`:
```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace(['packages/*']);
```

- [ ] **Step 3: Write the contracts package skeleton + failing smoke test**

`packages/contracts/package.json`:
```json
{
  "name": "@aeos/contracts",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "ulid": "^2.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "zod-to-json-schema": "^3.23.5"
  }
}
```

`packages/contracts/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/contracts/src/index.ts`:
```ts
export const PROTOCOL_VERSION = 1 as const;
```

`packages/contracts/test/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/index.js';

describe('contracts smoke', () => {
  it('exposes the protocol version', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
```

- [ ] **Step 4: Install and run — verify green**

Run: `pnpm install && pnpm test && pnpm build && pnpm typecheck`
Expected: 1 test passes; build and typecheck exit 0. (If the test fails on import resolution, check the `.js` extension in the import — NodeNext requires it.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml .npmrc .nvmrc .gitignore tsconfig.base.json vitest.workspace.ts pnpm-lock.yaml packages/contracts docs/ROADMAP.md
git commit -m "chore: pnpm monorepo scaffold + contracts skeleton [AEOS-P1.M1.T1]"
```
(Mark `M1.T1` as `[x]` in `docs/ROADMAP.md` before committing.)

---

### Task 2: Event envelope schema  `[AEOS-P1.M1.T2]`

**Files:**
- Create: `packages/contracts/src/ids.ts`, `packages/contracts/src/envelope.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/envelope.test.ts`

**Interfaces:**
- Consumes: `PROTOCOL_VERSION` from Task 1.
- Produces: `newEventId(): string` (ULID); `EnvelopeBaseSchema` (Zod object with fields `v:number, id:string(ulid), ts:string(ISO datetime), source:string, agentId?:string, sessionId?:string, taskId?:string`); type `EnvelopeBase`. Task 4 extends this base per event type.

- [ ] **Step 1: Write the failing test**

`packages/contracts/test/envelope.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { EnvelopeBaseSchema, newEventId } from '../src/index.js';

const valid = {
  v: 1,
  id: '01JZX6YV1T9GN0WT5V4EXAMPLE',
  ts: '2026-07-13T10:00:00.000Z',
  source: 'kernel',
  agentId: 'agent-01',
};

describe('EnvelopeBaseSchema', () => {
  it('accepts a valid envelope and round-trips JSON', () => {
    const parsed = EnvelopeBaseSchema.parse(valid);
    expect(EnvelopeBaseSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('rejects a bad ULID id', () => {
    expect(() => EnvelopeBaseSchema.parse({ ...valid, id: 'not-a-ulid!' })).toThrow();
  });

  it('rejects a non-ISO timestamp', () => {
    expect(() => EnvelopeBaseSchema.parse({ ...valid, ts: '13/07/2026' })).toThrow();
  });

  it('rejects an unknown protocol version', () => {
    expect(() => EnvelopeBaseSchema.parse({ ...valid, v: 999 })).toThrow();
  });

  it('newEventId produces valid, monotonically sortable ids', () => {
    const a = newEventId();
    const b = newEventId();
    expect(EnvelopeBaseSchema.shape.id.parse(a)).toBe(a);
    expect(a < b).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aeos/contracts test`
Expected: FAIL — `EnvelopeBaseSchema`/`newEventId` not exported.

- [ ] **Step 3: Implement**

`packages/contracts/src/ids.ts`:
```ts
import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

/** ULID: 26 chars of Crockford base32, lexicographically time-sortable. */
export const ULID_REGEX = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

export function newEventId(): string {
  return ulid();
}
```

`packages/contracts/src/envelope.ts`:
```ts
import { z } from 'zod';
import { ULID_REGEX } from './ids.js';
import { PROTOCOL_VERSION } from './version.js';

/**
 * Base fields shared by every event in the system (spec §6).
 * Concrete events extend this with a literal `type` and a `payload`.
 */
export const EnvelopeBaseSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().regex(ULID_REGEX, 'must be a ULID'),
  ts: z.string().datetime(),
  source: z.string().min(1),
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
});

export type EnvelopeBase = z.infer<typeof EnvelopeBaseSchema>;
```

Move the version constant into its own file `packages/contracts/src/version.ts`:
```ts
export const PROTOCOL_VERSION = 1 as const;
```

Replace `packages/contracts/src/index.ts` with re-exports:
```ts
export { PROTOCOL_VERSION } from './version.js';
export { newEventId, ULID_REGEX } from './ids.js';
export { EnvelopeBaseSchema, type EnvelopeBase } from './envelope.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @aeos/contracts test && pnpm -F @aeos/contracts typecheck`
Expected: all envelope tests + smoke test PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts docs/ROADMAP.md
git commit -m "feat(contracts): event envelope base schema + ULID ids [AEOS-P1.M1.T2]"
```

---

### Task 3: Domain schemas (workspace, agent, credentials, session, objective)  `[AEOS-P1.M1.T3]`

**Files:**
- Create: `packages/contracts/src/domain/workspace.ts`, `src/domain/credential.ts`, `src/domain/agent.ts`, `src/domain/session.ts`, `src/domain/objective.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/domain.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (exact names later milestones import):
  - `WorkspaceSchema` / `Workspace`
  - `CredentialProfileSchema` / `CredentialProfile` (discriminated on `kind: 'subscription' | 'api-key' | 'gateway'`)
  - `AgentConfigSchema` / `AgentConfig` (shape of `agent.yaml`, incl. `harness.featureToggles` and `credentialProfileId`)
  - `SessionStateSchema`, `SessionRecordSchema` / `SessionRecord` (shape of `session.yaml`), `assertSessionTransition(from, to): void` (throws `InvalidTransitionError`)
  - `ObjectiveSchema`, `PlanTaskSchema`, `CheckpointSchema` and their types

- [ ] **Step 1: Write the failing test**

`packages/contracts/test/domain.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  AgentConfigSchema,
  assertSessionTransition,
  CheckpointSchema,
  CredentialProfileSchema,
  InvalidTransitionError,
  ObjectiveSchema,
  PlanTaskSchema,
  SessionRecordSchema,
  WorkspaceSchema,
} from '../src/index.js';

describe('domain schemas', () => {
  it('parses a workspace', () => {
    expect(WorkspaceSchema.parse({ id: 'mirrorfolio', name: 'Mirrorfolio' }).id).toBe('mirrorfolio');
  });

  it('parses all three credential profile kinds and rejects inline secrets', () => {
    expect(CredentialProfileSchema.parse({ id: 'sub', kind: 'subscription' }).kind).toBe('subscription');
    expect(
      CredentialProfileSchema.parse({ id: 'byok', kind: 'api-key', secretRef: 'anthropic/main' }).kind,
    ).toBe('api-key');
    const gw = CredentialProfileSchema.parse({
      id: 'or',
      kind: 'gateway',
      baseUrl: 'https://openrouter.ai/api/v1',
      secretRef: 'openrouter/main',
      model: 'anthropic/claude-sonnet-5',
    });
    expect(gw.kind).toBe('gateway');
    // secrets are ALWAYS refs into the secret store — never literal values
    expect(() =>
      CredentialProfileSchema.parse({ id: 'bad', kind: 'api-key', apiKey: 'sk-ant-xxx' }),
    ).toThrow();
  });

  it('parses an agent.yaml shape with hermetic defaults', () => {
    const agent = AgentConfigSchema.parse({
      id: 'ada',
      workspaceId: 'mirrorfolio',
      name: 'Ada',
      harness: { provider: 'claude-code' },
      credentialProfileId: 'byok',
    });
    // hermetic-by-default (spec D2): every toggle defaults to false
    expect(agent.harness.featureToggles).toEqual({
      plugins: false, skills: false, mcpServers: false, userClaudeMd: false, autoMemory: false,
    });
  });

  it('enforces the session state machine', () => {
    expect(() => assertSessionTransition('created', 'starting')).not.toThrow();
    expect(() => assertSessionTransition('running', 'waiting_approval')).not.toThrow();
    expect(() => assertSessionTransition('completed', 'running')).toThrow(InvalidTransitionError);
    expect(() => assertSessionTransition('created', 'completed')).toThrow(InvalidTransitionError);
  });

  it('parses session record, objective, plan task, and checkpoint fixtures', () => {
    expect(
      SessionRecordSchema.parse({
        id: '01JZX6YV1T9GN0WT5V4EXAMPLE',
        agentId: 'ada',
        state: 'running',
        providerSessionId: 'claude-abc',
        runnerPid: 4242,
      }).state,
    ).toBe('running');
    expect(ObjectiveSchema.parse({ id: 'obj-1', agentId: 'ada', title: 'Ship login', budgetUsd: 20 }).budgetUsd).toBe(20);
    expect(PlanTaskSchema.parse({ id: 'T1', title: 'Write schema', status: 'pending' }).status).toBe('pending');
    const cp = CheckpointSchema.parse({
      taskId: 'T1', status: 'completed', summary: 'Schema written and tested', costs: { usd: 0.42, tokens: 12345 },
    });
    expect(cp.costs.usd).toBeCloseTo(0.42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aeos/contracts test`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement**

`packages/contracts/src/domain/workspace.ts`:
```ts
import { z } from 'zod';

export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const WorkspaceSchema = z.object({
  id: z.string().regex(SLUG_REGEX),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
```

`packages/contracts/src/domain/credential.ts`:
```ts
import { z } from 'zod';

/**
 * Credential profiles (spec §9). Secrets are NEVER inline — `secretRef`
 * points into the daemon secret store. `.strict()` rejects stray keys like
 * `apiKey` so a literal secret cannot even parse.
 */
const base = z.object({ id: z.string().min(1) });

export const CredentialProfileSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('subscription') }).strict(),
  base.extend({ kind: z.literal('api-key'), secretRef: z.string().min(1) }).strict(),
  base
    .extend({
      kind: z.literal('gateway'),
      baseUrl: z.string().url(),
      secretRef: z.string().min(1),
      model: z.string().min(1).optional(),
    })
    .strict(),
]);
export type CredentialProfile = z.infer<typeof CredentialProfileSchema>;
```

`packages/contracts/src/domain/agent.ts`:
```ts
import { z } from 'zod';
import { SLUG_REGEX } from './workspace.js';

/** Hermetic-by-default harness feature toggles (spec D2, §9). */
export const FeatureTogglesSchema = z
  .object({
    plugins: z.boolean().default(false),
    skills: z.boolean().default(false),
    mcpServers: z.boolean().default(false),
    userClaudeMd: z.boolean().default(false),
    autoMemory: z.boolean().default(false),
  })
  .default({});

export const AgentConfigSchema = z.object({
  id: z.string().regex(SLUG_REGEX),
  workspaceId: z.string().regex(SLUG_REGEX),
  name: z.string().min(1),
  profile: z.string().optional(),
  avatar: z.string().optional(),
  harness: z.object({
    provider: z.enum(['claude-code', 'codex', 'opencode']),
    version: z.string().optional(),
    featureToggles: FeatureTogglesSchema,
  }),
  credentialProfileId: z.string().min(1),
  modelPreferences: z.record(z.string()).optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
```

`packages/contracts/src/domain/session.ts`:
```ts
import { z } from 'zod';
import { ULID_REGEX } from '../ids.js';

export const SESSION_STATES = [
  'created', 'starting', 'running', 'waiting_approval',
  'paused', 'completed', 'failed', 'orphaned',
] as const;

export const SessionStateSchema = z.enum(SESSION_STATES);
export type SessionState = z.infer<typeof SessionStateSchema>;

const TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  created: ['starting', 'failed'],
  starting: ['running', 'failed'],
  running: ['waiting_approval', 'paused', 'completed', 'failed', 'orphaned'],
  waiting_approval: ['running', 'failed', 'orphaned'],
  paused: ['running', 'failed', 'orphaned'],
  completed: [],
  failed: [],
  orphaned: ['running', 'failed'], // re-adoption path (spec §10)
};

export class InvalidTransitionError extends Error {
  constructor(from: SessionState, to: SessionState) {
    super(`invalid session transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertSessionTransition(from: SessionState, to: SessionState): void {
  if (!TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);
}

/** Shape of sessions/<id>/session.yaml (spec §7). */
export const SessionRecordSchema = z.object({
  id: z.string().regex(ULID_REGEX),
  agentId: z.string().min(1),
  objectiveId: z.string().min(1).optional(),
  state: SessionStateSchema,
  providerSessionId: z.string().optional(),
  runnerPid: z.number().int().positive().optional(),
  runnerSocket: z.string().optional(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
```

`packages/contracts/src/domain/objective.ts`:
```ts
import { z } from 'zod';

export const ObjectiveSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().min(1),
  definitionOfDone: z.string().optional(),
  budgetUsd: z.number().positive().optional(),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const PlanTaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'blocked']);

export const PlanTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: PlanTaskStatusSchema,
});
export type PlanTask = z.infer<typeof PlanTaskSchema>;

/** Shape of objectives/<id>/checkpoints/<task>.yaml (spec §12). */
export const CheckpointSchema = z.object({
  taskId: z.string().min(1),
  status: PlanTaskStatusSchema,
  commit: z.string().optional(),
  providerResumeToken: z.string().optional(),
  summary: z.string().min(1),
  costs: z.object({ usd: z.number().nonnegative(), tokens: z.number().int().nonnegative() }),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
```

Append to `packages/contracts/src/index.ts`:
```ts
export { WorkspaceSchema, SLUG_REGEX, type Workspace } from './domain/workspace.js';
export { CredentialProfileSchema, type CredentialProfile } from './domain/credential.js';
export { AgentConfigSchema, FeatureTogglesSchema, type AgentConfig } from './domain/agent.js';
export {
  SESSION_STATES, SessionStateSchema, SessionRecordSchema, assertSessionTransition,
  InvalidTransitionError, type SessionState, type SessionRecord,
} from './domain/session.js';
export {
  ObjectiveSchema, PlanTaskSchema, PlanTaskStatusSchema, CheckpointSchema,
  type Objective, type PlanTask, type Checkpoint,
} from './domain/objective.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @aeos/contracts test && pnpm -F @aeos/contracts typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts docs/ROADMAP.md
git commit -m "feat(contracts): domain schemas incl. credential profiles + session state machine [AEOS-P1.M1.T3]"
```

---

### Task 4: Canonical event taxonomy  `[AEOS-P1.M1.T4]`

**Files:**
- Create: `packages/contracts/src/events/taxonomy.ts`, `packages/contracts/test/fixtures/events.golden.ndjson`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/events.test.ts`

**Interfaces:**
- Consumes: `EnvelopeBaseSchema` (Task 2), `SessionStateSchema` (Task 3).
- Produces: `AeosEventSchema` (discriminated union on `type`), type `AeosEvent`, `AEOS_EVENT_TYPES: readonly string[]`. Provider adapters (M4) emit these; the event bus (M2) transports them; SSE (M7) serves them.

- [ ] **Step 1: Write the golden fixture (one line per event type)**

`packages/contracts/test/fixtures/events.golden.ndjson`:
```
{"v":1,"id":"01JZX6YV1T9GN0WT5V400001A","ts":"2026-07-13T10:00:00.000Z","source":"kernel","agentId":"ada","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"session.created","payload":{}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V400002A","ts":"2026-07-13T10:00:01.000Z","source":"runner","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"session.state_changed","payload":{"from":"created","to":"starting"}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V400003A","ts":"2026-07-13T10:00:02.000Z","source":"provider:claude-code","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"turn.started","payload":{"turn":1}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V400004A","ts":"2026-07-13T10:00:03.000Z","source":"provider:claude-code","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"item.message","payload":{"role":"assistant","text":"Reading the plan."}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V400005A","ts":"2026-07-13T10:00:04.000Z","source":"provider:claude-code","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"item.tool_call","payload":{"callId":"c1","tool":"Bash","input":{"command":"pnpm test"}}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V400006A","ts":"2026-07-13T10:00:05.000Z","source":"provider:claude-code","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"item.tool_result","payload":{"callId":"c1","ok":true,"output":"42 passed"}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V400007A","ts":"2026-07-13T10:00:06.000Z","source":"provider:claude-code","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"item.file_change","payload":{"path":"src/login.ts","kind":"modified"}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V400008A","ts":"2026-07-13T10:00:07.000Z","source":"provider:claude-code","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"cost.usage","payload":{"profileId":"byok","usd":0.0421,"inputTokens":9120,"outputTokens":1330,"cacheReadTokens":8000}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V400009A","ts":"2026-07-13T10:00:08.000Z","source":"policy","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"approval.request","payload":{"requestId":"a1","action":"git_push","detail":"push branch ada/login to origin","expiresAt":"2026-07-13T10:10:08.000Z"}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V40000AA","ts":"2026-07-13T10:00:09.000Z","source":"provider:claude-code","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"turn.completed","payload":{"turn":1}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V40000BA","ts":"2026-07-13T10:00:10.000Z","source":"kernel","sessionId":"01JZX6YV1T9GN0WT5V4SESS01","type":"session.completed","payload":{}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V40000CA","ts":"2026-07-13T10:00:11.000Z","source":"kernel","sessionId":"01JZX6YV1T9GN0WT5V4SESS02","type":"session.failed","payload":{"reason":"provider exited 1"}}
{"v":1,"id":"01JZX6YV1T9GN0WT5V40000DA","ts":"2026-07-13T10:00:12.000Z","source":"runner","sessionId":"01JZX6YV1T9GN0WT5V4SESS03","type":"turn.failed","payload":{"turn":2,"reason":"usage_limit"}}
```

- [ ] **Step 2: Write the failing test**

`packages/contracts/test/events.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AEOS_EVENT_TYPES, AeosEventSchema, type AeosEvent } from '../src/index.js';

const lines = readFileSync(join(import.meta.dirname, 'fixtures/events.golden.ndjson'), 'utf8')
  .trim().split('\n');

describe('canonical event taxonomy', () => {
  it('parses every golden fixture line', () => {
    for (const line of lines) {
      expect(() => AeosEventSchema.parse(JSON.parse(line)), line).not.toThrow();
    }
  });

  it('the golden file covers every declared event type (exhaustiveness)', () => {
    const seen = new Set(lines.map((l) => (JSON.parse(l) as { type: string }).type));
    expect([...seen].sort()).toEqual([...AEOS_EVENT_TYPES].sort());
  });

  it('rejects unknown event types', () => {
    const base = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(() => AeosEventSchema.parse({ ...base, type: 'session.hacked' })).toThrow();
  });

  it('narrows payload types via the discriminant', () => {
    const ev = AeosEventSchema.parse(JSON.parse(lines[7]!)) as AeosEvent;
    if (ev.type === 'cost.usage') expect(ev.payload.usd).toBeGreaterThan(0);
    else throw new Error('expected cost.usage at line 8');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F @aeos/contracts test`
Expected: FAIL — `AeosEventSchema` not exported.

- [ ] **Step 4: Implement**

`packages/contracts/src/events/taxonomy.ts`:
```ts
import { z } from 'zod';
import { EnvelopeBaseSchema } from '../envelope.js';
import { SessionStateSchema } from '../domain/session.js';

const ev = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  EnvelopeBaseSchema.extend({ type: z.literal(type), payload });

const empty = z.object({}).strict();

export const AeosEventSchema = z.discriminatedUnion('type', [
  ev('session.created', empty),
  ev('session.state_changed', z.object({ from: SessionStateSchema, to: SessionStateSchema })),
  ev('session.completed', empty),
  ev('session.failed', z.object({ reason: z.string() })),
  ev('session.orphaned', empty),
  ev('turn.started', z.object({ turn: z.number().int().positive() })),
  ev('turn.completed', z.object({ turn: z.number().int().positive() })),
  ev('turn.failed', z.object({ turn: z.number().int().positive(), reason: z.string() })),
  ev('item.message', z.object({ role: z.enum(['assistant', 'user', 'system']), text: z.string() })),
  ev('item.tool_call', z.object({ callId: z.string(), tool: z.string(), input: z.unknown() })),
  ev('item.tool_result', z.object({ callId: z.string(), ok: z.boolean(), output: z.string() })),
  ev('item.file_change', z.object({ path: z.string(), kind: z.enum(['created', 'modified', 'deleted']) })),
  ev('cost.usage', z.object({
    profileId: z.string(),
    usd: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
  })),
  ev('approval.request', z.object({
    requestId: z.string(),
    action: z.string(),
    detail: z.string(),
    expiresAt: z.string().datetime(),
  })),
]);

export type AeosEvent = z.infer<typeof AeosEventSchema>;

export const AEOS_EVENT_TYPES = AeosEventSchema.options.map(
  (o) => o.shape.type.value,
) as readonly string[];
```

Note: `session.orphaned` is in the schema but not the golden file yet — the exhaustiveness test will FAIL until you add this golden line (id suffix `...0000EA`, source `kernel`, empty payload). Add it; the test failing first is the point.

Append to `packages/contracts/src/index.ts`:
```ts
export { AeosEventSchema, AEOS_EVENT_TYPES, type AeosEvent } from './events/taxonomy.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @aeos/contracts test && pnpm -F @aeos/contracts typecheck`
Expected: PASS (after adding the `session.orphaned` golden line).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts docs/ROADMAP.md
git commit -m "feat(contracts): canonical event taxonomy + golden fixtures [AEOS-P1.M1.T4]"
```

---

### Task 5: JSON Schema export + drift test  `[AEOS-P1.M1.T5]`

**Files:**
- Create: `packages/contracts/scripts/gen-schemas.ts`, `packages/contracts/schemas/` (generated output, committed)
- Modify: `packages/contracts/package.json` (add `gen:schemas` script + `tsx` devDependency)
- Test: `packages/contracts/test/schema-drift.test.ts`

**Interfaces:**
- Consumes: all exported schemas from Tasks 2–4.
- Produces: `schemas/<name>.schema.json` files — the language-neutral plugin ABI (spec §15). Non-TS implementations validate against these.

- [ ] **Step 1: Write the failing drift test**

`packages/contracts/test/schema-drift.test.ts`:
```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateAllSchemas } from '../scripts/gen-schemas.js';

const schemasDir = join(import.meta.dirname, '../schemas');

describe('generated JSON Schemas', () => {
  it('committed schemas match regenerated output (no drift)', () => {
    const generated = generateAllSchemas();
    const committed = Object.fromEntries(
      readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json'))
        .map((f) => [f, readFileSync(join(schemasDir, f), 'utf8')]),
    );
    expect(committed).toEqual(generated);
  });

  it('covers the core contract surface', () => {
    expect(Object.keys(generateAllSchemas()).sort()).toEqual([
      'aeos-event.schema.json',
      'agent-config.schema.json',
      'checkpoint.schema.json',
      'credential-profile.schema.json',
      'envelope-base.schema.json',
      'objective.schema.json',
      'plan-task.schema.json',
      'session-record.schema.json',
      'workspace.schema.json',
    ]);
  });
});
```

- [ ] **Step 2: Implement the generator**

Add to `packages/contracts/package.json` devDependencies: `"tsx": "^4.19.2"`, and scripts: `"gen:schemas": "tsx scripts/gen-schemas.ts"`.

`packages/contracts/scripts/gen-schemas.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  AeosEventSchema, AgentConfigSchema, CheckpointSchema, CredentialProfileSchema,
  EnvelopeBaseSchema, ObjectiveSchema, PlanTaskSchema, SessionRecordSchema, WorkspaceSchema,
} from '../src/index.js';

const SOURCES: Record<string, ZodTypeAny> = {
  'envelope-base': EnvelopeBaseSchema,
  'aeos-event': AeosEventSchema,
  'workspace': WorkspaceSchema,
  'credential-profile': CredentialProfileSchema,
  'agent-config': AgentConfigSchema,
  'session-record': SessionRecordSchema,
  'objective': ObjectiveSchema,
  'plan-task': PlanTaskSchema,
  'checkpoint': CheckpointSchema,
};

export function generateAllSchemas(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, schema] of Object.entries(SOURCES)) {
    const json = zodToJsonSchema(schema, { name, $refStrategy: 'none' });
    out[`${name}.schema.json`] = JSON.stringify(json, null, 2) + '\n';
  }
  return out;
}

// CLI entry: write files when run directly (tsx scripts/gen-schemas.ts)
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../schemas');
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(generateAllSchemas())) {
    writeFileSync(join(dir, file), content);
    console.log(`wrote schemas/${file}`);
  }
}
```

- [ ] **Step 3: Generate, then verify tests pass**

Run: `pnpm install && pnpm -F @aeos/contracts gen:schemas && pnpm -F @aeos/contracts test`
Expected: 9 schema files written; all tests PASS. (The drift test failed before generation — that was its RED phase.)

- [ ] **Step 4: Commit (schemas included)**

```bash
git add packages/contracts docs/ROADMAP.md
git commit -m "feat(contracts): JSON Schema export with drift test [AEOS-P1.M1.T5]"
```

---

### Task 6: Boundary enforcement + CI  `[AEOS-P1.M1.T6]`

**Files:**
- Create: `.dependency-cruiser.cjs`, `.github/workflows/ci.yml`
- Modify: root `package.json` (add `depcruise` script + devDependency)

**Interfaces:**
- Consumes: the workspace layout from Task 1.
- Produces: the CI gate every future milestone must keep green: `pnpm install → build → typecheck → test → depcruise → schema drift`.

- [ ] **Step 1: Add dependency-cruiser config**

Add to root `package.json` devDependencies: `"dependency-cruiser": "^16.8.0"`, scripts: `"depcruise": "depcruise packages apps --config .dependency-cruiser.cjs"`.

`.dependency-cruiser.cjs`:
```js
/** Enforces spec §5: packages talk through published entry points only. */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-package-internals',
      severity: 'error',
      comment:
        'Import other workspace packages via their package name (@aeos/x), never via relative paths into their src/.',
      from: { path: '^(packages|apps)/([^/]+)/' },
      to: { path: '^packages/([^/]+)/src/', pathNot: '^packages/$2/src/' },
    },
    {
      name: 'contracts-depends-on-nothing',
      severity: 'error',
      comment: 'packages/contracts is the dependency root (spec §5).',
      from: { path: '^packages/contracts/' },
      to: { path: '^(packages|apps)/', pathNot: '^packages/contracts/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
  },
};
```

- [ ] **Step 2: Verify the rule bites (RED), then passes (GREEN)**

Create a throwaway violation: add `packages/contracts/src/bad.ts` containing `import '../../..//apps/nothing.js';` — actually, simpler and real: create `packages/scratch/package.json` (`{"name":"@aeos/scratch","type":"module"}`) and `packages/scratch/src/bad.ts` containing:
```ts
import { PROTOCOL_VERSION } from '../../contracts/src/version.js';
export const v = PROTOCOL_VERSION;
```
Run: `pnpm install && pnpm depcruise`
Expected: **error** `no-cross-package-internals` flagged.
Then delete `packages/scratch/` entirely and run `pnpm depcruise` again.
Expected: exit 0, no violations.

- [ ] **Step 3: Add CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm depcruise
      - name: schema drift check
        run: |
          pnpm -F @aeos/contracts gen:schemas
          git diff --exit-code packages/contracts/schemas
```

- [ ] **Step 4: Run the full CI command chain locally**

Run: `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`
Expected: everything green.

- [ ] **Step 5: Commit + mark milestone complete**

```bash
git add .dependency-cruiser.cjs .github/workflows/ci.yml package.json pnpm-lock.yaml docs/ROADMAP.md
git commit -m "ci: boundary enforcement + CI pipeline; M1 exit gate [AEOS-P1.M1.T6]"
```
Mark `M1` and all its tasks `[x]` in `docs/ROADMAP.md` in this commit. **M1 exit gate:** CI green on `main` — then and only then may `M2`'s plan be written (see `docs/ROADMAP.md` M2 context brief).
