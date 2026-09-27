# @aeos/contracts

## 1.0.0-rc.2

No changes in this release.

## 1.0.0-rc.1

### Major Changes

- AEOS 1.0 — the first stable release. From 1.0 on, `docs/compatibility.md`
  binds: semver per surface, additive contracts within a major, a gated plugin
  ABI, and automatic `AEOS_HOME` migrations within a major. No breaking change
  from v0.4: the major marks the stability promise, not an incompatibility.

## 0.4.0

### Minor Changes

- 006812b: P4 — scale + community (v0.4):
  - **Container sandbox tier:** per-task-class `sandbox` policy; harnesses run
    in a container that sees only the worktree, their profile and their binary.
  - **Public plugin API:** `aeos` manifest + plugin ABI gate, out-of-process
    plugin host (crashes fail only their sessions), `aeos plugin install`,
    `create-aeos-plugin`.
  - **Deploy targets:** `aeos service install` (systemd/launchd), docker
    compose image, remote posture (token on `/v1`, web sign-in, TLS guide).
  - **TLS-PSK TCP runner transport** with mutual auth, and a Helm chart
    (golden path on kind nightly).
  - CLI: `aeos approvals`, `aeos sandbox`, `aeos service`, `aeos plugin`.
