---
"@aeos/contracts": minor
"@aeos/plugins": minor
"@aeos/provider-core": minor
"@aeos/runner": minor
"@aeos/cli": minor
"create-aeos-plugin": minor
---

P4 — scale + community (v0.4):
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
