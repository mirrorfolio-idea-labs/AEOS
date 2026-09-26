# AEOS P4.M1 — Docker Sandbox Tier

## Design (spec §10)

- **Tiers.** `none` (trusted local mode; still scoped to the worktree and
  policy-gated) and `container`. Harness-native sandboxes (Codex
  `--sandbox`, Claude permission flags) still apply inside either tier.
- **Selection (T2).** Policy YAML gains an additive block:
  `sandbox: {tier, classes: {<taskClass>: tier}, image, network}`.
  - Layers merge workspace → agent → objective, key by key; `classes`
    merges class by class.
  - `sandboxFor(effective, taskClass)` picks the class override, else the
    default tier, else `none`.
  - With no sandbox layer, `EffectivePolicy` is byte-identical to before;
    `DEFAULT_POSTURE` is unchanged.
  - Delegated tasks use the *delegate's* policy.
  - The choice is audited on `route.decided` (`sandbox`, an additive
    field).
- **Spawn path (T1).**
  - Adapters' `resolveCommand` now receives a `CommandContext`
    `{sessionId, workdir, profile}`.
  - For the container tier, the daemon wraps the resolved harness argv with
    `containerArgv`, which builds a `docker run` with:
    - `--rm --init`;
    - the name `aeos-<session>`;
    - labels `aeos.managed` and `aeos.home=<hash>`;
    - `--cap-drop ALL --security-opt no-new-privileges`;
    - `--user <host uid:gid>`, so worktree files stay owned by the operator;
    - `--network none|bridge` (default `bridge`, because a harness must
      reach its model API).
  - **Only** these paths are mounted, each at the same path as on the host:
    - the worktree, and its git common dir (git needs its objects);
    - the agent's harness profile directory;
    - the harness binary, read-only. That is the managed `<home>/binaries`
      tree or a BYO file.
  - Profile env is forwarded as `-e KEY`, so docker reads each value from
    its own env. Secrets never appear in argv or `ps`.
  - Kill: the runner SIGTERMs the docker client, which proxies the signal
    to `--init`, and `--rm` cleans up.
  - Adoption: a container never outlives its daemon usefully. On boot,
    labelled leftovers for this home are reaped, and resume re-spawns a
    fresh container from the checkpoint's provider resume token.
- **Image.** `docker/runner/Dockerfile` is `node:22-slim` plus git, CA
  certificates, ripgrep and ssh, with `safe.directory '*'`.
  - Harness binaries are mounted, not baked in, so the P2.M7 pins stay the
    single source of truth.
  - `aeos sandbox build|status` builds the image from a copy embedded in
    the CLI, which is drift-tested against the repo file.

## Verification

- `provider-core/test/sandbox.test.ts`:
  - golden argv: only the listed mounts, env passed by name, and no secret
    value in argv;
  - read-write wins over read-only;
  - the git common dir is found for linked worktrees.
- `policy/test/sandbox.test.ts`: a policy fixture switches tiers per class
  across three layers (**T2 accept, part 1**); typos are rejected.
- `aeosd/test/sandbox-container.e2e.test.ts` (**T1 accept + T2 escape
  canary + exit gate**). It runs on the real daemon, with the real Claude
  adapter and a BYO stand-in binary.
  - The `implement` task runs in the container: `/.dockerenv` exists, the
    uid is the host's, and its work is committed to the agent branch.
  - A host canary outside the worktree gives ENOENT, and the host file is
    byte-identical afterwards.
  - The `docs` task, set to `none` by the same policy, *can* read the
    canary, which proves the canary test itself works.
  - No labelled container outlives its session.
- CI:
  - the `ci` job runs the e2e on `node:22-slim`;
  - the new `sandbox-image` job builds `aeos-runner` through the CLI and
    runs the same e2e on it.
