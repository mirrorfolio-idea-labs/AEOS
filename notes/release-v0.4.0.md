# AEOS v0.4.0 — Scale + community

Everything since `v0.3.0`. **Phase P4 exit gate: green on code.**
- Every deploy target has a CI-tested quickstart: `compose-quickstart`,
  `nightly-k8s` (a kind cluster) and service-unit verification.
- A third-party plugin builds and installs without touching core. A
  tarball-installed `create-aeos-plugin` template passes the stock adapter
  conformance suite.

## Highlights

- **Container sandbox tier** (P4.M1).
  - Policy `sandbox: {tier, classes, image, network}` chooses, per task
    class, whether a harness runs in a container.
  - Inside, it sees only its worktree (plus the git dir), its profile and
    its own read-only binary. Environment values are passed by name, so
    they never appear on a command line. The container runs as your uid
    with all capabilities dropped.
  - `aeos sandbox build` builds the runtime image.
- **Public plugin API** (P4.M2).
  - Plugins are npm packages with an `aeos` manifest. They are gated on
    `PLUGIN_ABI_VERSION`, and a mismatch is refused with a typed
    `contract_mismatch` error.
  - Each plugin runs in its own process. A crash fails only its own session
    and the plugin restarts on demand.
  - `aeos plugin install` runs no install scripts.
  - `create-aeos-plugin` scaffolds a plugin; `docs/plugins.md` is the
    author guide.
- **Deploy targets** (P4.M3).
  - `aeos service install` sets up a systemd user unit or a LaunchAgent.
    Stopping the service stops only the daemon; runners survive restarts.
  - `docker compose up` runs a non-root image with the token passed as a
    secret.
  - Remote posture: a token gate on `/v1`, sign-in in the web UI, and a TLS
    guide for Caddy and nginx.
- **Runners over TCP + Kubernetes** (P4.M4).
  - A TLS-PSK runner transport with mutual authentication and a
    per-session key.
  - A Helm chart: a single-writer Deployment, a PVC, a token that is kept
    across upgrades, and a hardened pod.
- **CLI.** `aeos approvals list|approve|deny`, `aeos service`,
  `aeos plugin`, `aeos sandbox`. `objective run` now tells you what it is
  waiting for.

## Fixes worth knowing

- Objective and planner sessions now have session records and
  transcripts. Before this, every event logged a `TranscriptRoutingError`
  and no transcript was written.
- A token-protected daemon can now serve its own web UI. Previously the UI
  was unreachable once a token was set.
- An objective run that errors is now logged. Previously the failure was
  silent.

## Upgrade notes

- All contracts changes are additive:
  - `PolicyFile.sandbox` and `EffectivePolicy.sandbox`;
  - `harness.provider` also accepts `plugin:<id>`;
  - `route.decided` has a new optional `sandbox` field;
  - there is a new `plugin-manifest` schema.
- Token auth now covers `/v1/*` only. The web UI shell and `/healthz` are
  served without a token.
- New optional environment variables:
  - `AEOS_API_TOKEN_FILE` — read the token from a file instead of the
    environment.
  - `AEOS_RUNNER_TRANSPORT=tcp` and `AEOS_RUNNER_HOST` — run runners over
    TCP.

## Known limits / still open

- The logout/reboot test for `aeos service install` and the VM TLS check
  are manual sign-offs (P4.M3.T1, T3).
- Plugin providers can't use the container sandbox tier yet. They fail
  closed.
