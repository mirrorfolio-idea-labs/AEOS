---
"@aeos/aeosd": patch
---

Security: objectives resumed after a daemon crash or restart, and objectives
started by scheduled jobs, now go through the agent's policy and the
approvals inbox like every other run. Before this fix those runs used a
context without a policy, so a gated tool call (for example a shell command
parked for approval when the daemon died) ran after the restart without
anyone approving it.
