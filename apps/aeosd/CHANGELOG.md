# @aeos/aeosd

## 1.0.0-rc.2

### Patch Changes

- b71e9b0: Security: objectives resumed after a daemon crash or restart, and objectives
  started by scheduled jobs, now go through the agent's policy and the
  approvals inbox like every other run. Before this fix those runs used a
  context without a policy, so a gated tool call (for example a shell command
  parked for approval when the daemon died) ran after the restart without
  anyone approving it.
- @aeos/api@1.0.0-rc.2
  - @aeos/contracts@1.0.0-rc.2
  - @aeos/kernel@1.0.0-rc.2
  - @aeos/memory@1.0.0-rc.2
  - @aeos/plugins@1.0.0-rc.2
  - @aeos/policy@1.0.0-rc.2
  - @aeos/provider-claude@1.0.0-rc.2
  - @aeos/provider-codex@1.0.0-rc.2
  - @aeos/provider-core@1.0.0-rc.2
  - @aeos/provider-opencode@1.0.0-rc.2
  - @aeos/router@1.0.0-rc.2
  - @aeos/runner@1.0.0-rc.2
  - @aeos/scheduler@1.0.0-rc.2
  - @aeos/secrets@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies
  - @aeos/contracts@1.0.0-rc.1
  - @aeos/api@1.0.0-rc.1
  - @aeos/kernel@1.0.0-rc.1
  - @aeos/memory@1.0.0-rc.1
  - @aeos/plugins@1.0.0-rc.1
  - @aeos/policy@1.0.0-rc.1
  - @aeos/provider-claude@1.0.0-rc.1
  - @aeos/provider-codex@1.0.0-rc.1
  - @aeos/provider-core@1.0.0-rc.1
  - @aeos/provider-opencode@1.0.0-rc.1
  - @aeos/router@1.0.0-rc.1
  - @aeos/runner@1.0.0-rc.1
  - @aeos/scheduler@1.0.0-rc.1
  - @aeos/secrets@1.0.0-rc.1

## 0.4.0

### Patch Changes

- Updated dependencies [006812b]
  - @aeos/contracts@0.4.0
  - @aeos/plugins@0.4.0
  - @aeos/provider-core@0.4.0
  - @aeos/runner@0.4.0
  - @aeos/api@0.4.0
  - @aeos/kernel@0.4.0
  - @aeos/memory@0.4.0
  - @aeos/policy@0.4.0
  - @aeos/provider-claude@0.4.0
  - @aeos/provider-codex@0.4.0
  - @aeos/provider-opencode@0.4.0
  - @aeos/router@0.4.0
  - @aeos/scheduler@0.4.0
  - @aeos/secrets@0.4.0
