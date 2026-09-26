# AEOS P4.M2 — Public Plugin API

## Design (spec §15)

### T1 — manifest, loader, contract gate
- `contracts` is the ABI.
  - `PLUGIN_ABI_VERSION` (`1.0.0`).
  - `PluginManifestSchema`: the package.json `aeos` field, with
    `{contract: <semver range>, entry, contributes: [{kind, id}]}`.
    `kind` is one of the seven kinds listed in spec §15.
  - JSON Schema `plugin-manifest.schema.json`.
- `harness.provider` widens additively to builtins | `plugin:<id>`. At the
  type level this is a template-literal type, so exhaustive switches still
  catch mistakes.
- New `@aeos/plugins` package:
  - `readPluginPackage`;
  - `assertContract`, which throws the typed `PluginError{code:
    contract_mismatch}`;
  - a minimal semver matcher that rejects ranges it cannot parse instead of
    guessing.
- **Core plugins use the public mechanism.** The daemon's composition root
  registers the Claude Code, Codex and OpenCode adapters as core plugins
  (manifest + contract gate) in the same `PluginRegistry` that installed
  plugins use. `adapterFor` resolves every provider through it.

### T2 — install flow and crash isolation
- `aeos plugin install <npm spec | tarball | dir>` installs into
  `<home>/plugins`, a private npm prefix.
  - It runs with `--ignore-scripts`: installing never executes the
    package's scripts.
  - A package with a bad manifest or the wrong ABI is uninstalled again and
    refused.
  - `aeos plugin list|remove`.
- Each installed plugin runs in **its own child process** (`PluginHost`),
  which speaks JSON over IPC.
  - Plugins emit only `{type, payload}`. The host stamps the envelope (ULID,
    timestamp, session id, `source: plugin:<id>`) and validates it. An
    off-contract event ends the session with `session.failed`.
  - A crash fails the sessions in flight (`session.failed`, with the exit
    reason) and nothing else. The next call restarts the child; 3 crashes
    within 60 s disable the plugin.
  - A plugin that fails to load is reported at boot and never thrown at the
    daemon.
  - `translate()` is pure and synchronous, so it runs in a throwaway child.
- **Fail closed.** A policy requiring the container sandbox tier for a
  plugin provider refuses the task, because plugin processes are not yet
  containerised.

### T3 — author guide and template
- `docs/plugins.md` is the author guide.
- `create-aeos-plugin` scaffolds a dependency-free, plain-JS echo provider
  with the manifest filled in.

## Verification
- `plugins/test/plugins.test.ts` (19 tests):
  - semver forms;
  - **T1 accept:** a version-mismatched plugin is refused with the typed
    error;
  - bad or escaping manifests are typed errors;
  - install refuses a wrong-ABI plugin, removes it and runs no postinstall;
  - **T2 accept:** a mid-session crash fails only that session, and the
    next call restarts the plugin;
  - repeated crashes disable the plugin;
  - off-contract events are rejected;
  - a load failure is reported, not thrown.
- `aeosd/test/plugin-crash.e2e.test.ts`: on the real daemon, a plugin
  installed with `aeos plugin install` crashes (`process.exit`) during an
  objective. The daemon keeps serving, the scheduler's retry succeeds on the
  restarted plugin (`attempts: 2`), and the next objective completes.
- `create-aeos-plugin/test/template-conformance.test.ts` (**T3 accept +
  exit gate**): scaffold → `npm pack` → `aeos plugin install <tarball>` →
  load out of process. The provider passes the unmodified
  `describeAdapterConformance` suite, the same one the first-party
  adapters pass.
