# @aeos/cli

## 1.0.0-rc.2

### Patch Changes

- @aeos/contracts@1.0.0-rc.2
  - @aeos/plugins@1.0.0-rc.2
  - @aeos/provider-core@1.0.0-rc.2
  - @aeos/sdk@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @aeos/contracts@1.0.0-rc.1
  - @aeos/plugins@1.0.0-rc.1
  - @aeos/provider-core@1.0.0-rc.1
  - @aeos/sdk@1.0.0-rc.1

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

### Patch Changes

- Updated dependencies [006812b]
  - @aeos/contracts@0.4.0
  - @aeos/plugins@0.4.0
  - @aeos/provider-core@0.4.0
  - @aeos/sdk@0.4.0
