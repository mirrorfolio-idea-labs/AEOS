# Third-party notices

AEOS is MIT-licensed (see `LICENSE`). It includes, or is derived from, the
following third-party material.

| Material | Source | License | Where |
|---|---|---|---|
| Agent screen-state detection manifests (claude, codex, opencode) | [herdr](https://github.com/herdrdev/herdr) | Apache-2.0 | `packages/runner/manifests/` (see `NOTICE.md` + `LICENSE-herdr` there) |

## Ideas adopted, no code copied

- **herdr-agent-inbox** (MIT, douglascorrea/herdr-agent-inbox): the
  attention-sorted inbox with settle and mark-unread triage (`/v1/inbox`).
- **herdr-reviewr** (MIT, persiyanov/herdr-reviewr): a diff review pane
  whose line comments go back to the agent (ADE Review tab).
- **herdr-remote** (AGPL-3.0, dcolinmorgan/herdr-remote): only the concept
  of pushing agent-attention events to a phone is reused, via AEOS's own
  webhook notifier. None of its code was used, which keeps AEOS free of AGPL
  obligations.

npm dependency licenses are audited in
`docs/oss/license-audit-2026-07-18.md`.
