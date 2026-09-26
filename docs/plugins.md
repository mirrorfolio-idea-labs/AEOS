# Writing an AEOS plugin

AEOS plugins are npm packages. A plugin can add providers (another coding
agent or model backend) and, as the ABI grows, other contributions. It never
touches AEOS core. This guide covers the **provider** kind, which is available
now.

## Scaffold one

```bash
npx create-aeos-plugin aeos-plugin-mytool --id mytool
cd aeos-plugin-mytool
npm pack                                   # → aeos-plugin-mytool-0.1.0.tgz
aeos plugin install ./aeos-plugin-mytool-0.1.0.tgz
aeos plugin list
# restart aeosd; then point an agent at it:
aeos agent create dev --workspace ws --name Dev --provider plugin:mytool
```

The template is a working echo provider. It passes the same adapter
conformance suite as the first-party Claude Code, Codex and OpenCode
adapters.

## The manifest

`package.json` carries an `aeos` field. It is validated against
[`plugin-manifest.schema.json`](../packages/contracts/schemas/plugin-manifest.schema.json):

```json
"aeos": {
  "contract": "^1",
  "entry": "./src/index.js",
  "contributes": [{ "kind": "provider", "id": "mytool" }]
}
```

- **`contract`** is a semver range over the AEOS plugin ABI
  (`PLUGIN_ABI_VERSION`, currently `1.0.0`). Supported forms: `^1`, `~1.0`,
  `1.0.0`, `>=1.0.0 <2`, `*`. If the range does not admit the running ABI,
  AEOS refuses the plugin at install time and at load time, with the typed
  error `contract_mismatch`. A half-compatible plugin is never loaded.
- **`entry`** is an ES module inside the package whose default export is
  `{ providers: { <id>: () => provider } }`.
- **`contributes`** lists what the plugin provides. Provider `mytool` becomes
  `plugin:mytool` for agents and `routing.yaml`.

## The provider contract

```js
export default { providers: { mytool: () => ({
  capabilities() { return { resume, structuredOutput, mcp, sandbox, costReporting, costUsd? } },
  createProfile(agent) { return { rootDir, env, argv } },     // may be async
  spawn(opts) { return { events, kill(), providerSessionId?, resumeToken?, costUsd? } },
  translate(raw) { return [{ type, payload }, ...] },          // pure
}) } };
```

- **`events`** is an async iterable of `{ type, payload }` objects from the
  AEOS event taxonomy (`aeos-event.schema.json`).
  - You do **not** write ids, timestamps or session ids. AEOS stamps and
    validates every event.
  - An event outside the contract ends the session with `session.failed`.
  - Start with `session.created` and end with `session.completed` or
    `session.failed`.
- **`spawn(opts)`** receives `{ profile, sessionId, objective, workdir?,
  model?, resumeToken?, permissionPolicy? }`. `workdir` is the objective's
  git worktree, and it is where your agent should work.
- **`createProfile`** must be hermetic. No `$HOME` or `~/` references: each
  AEOS agent owns its own state.
- **Capabilities must be true.** The conformance suite checks them against
  behaviour.
- **No runtime dependency on AEOS is needed.** The template is plain
  JavaScript. Use `@aeos/contracts` for types and
  `@aeos/provider-core/conformance` for tests as dev dependencies if you
  like.

## Isolation and failure

- **Own process.** Each installed plugin runs in its own child process. A
  throw, a hang or a `process.exit` in your plugin fails **only** the
  session in flight, which ends with `session.failed`. The daemon keeps
  running, and the scheduler's normal 3-strike retry applies.
- **Restarts.** The plugin restarts on its next use. After 3 crashes within
  a minute it is disabled until the daemon restarts.
- **Install scripts.** `aeos plugin install` runs with `--ignore-scripts`:
  installing a plugin never executes its lifecycle scripts.
- **Container tier.** Plugin providers cannot yet run in the container
  sandbox tier (P4.M1). If a policy requires that tier for a plugin-backed
  task, the task is refused (fail closed) rather than run uncontained.

## Testing against the conformance suite

In the AEOS monorepo (or with `@aeos/provider-core` installed):

```ts
import { describeAdapterConformance } from '@aeos/provider-core/conformance';
import { createPluginRegistry } from '@aeos/plugins';
// install your tarball into a temp AEOS_HOME, loadInstalled(), then:
describeAdapterConformance('plugin:mytool', { makeAdapter, agent, rawCorpus, capabilityClaims });
```

`packages/create-aeos-plugin/test/template-conformance.test.ts` is a
complete, runnable example. It scaffolds the template, packs it, installs the
tarball and runs the suite.
