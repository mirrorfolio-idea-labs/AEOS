# AEOS v1.0.0

The first stable release. From here on, [`docs/compatibility.md`](../docs/compatibility.md)
binds: semver per surface, additive contracts within a major, a gated
plugin ABI, and automatic `AEOS_HOME` migrations within a major.

## What 1.0 is

Durable, resumable AI coding agents whose entire state lives as files.
See the v0.2, v0.3 and v0.4 release notes for the detail:

- **Safety.** Least privilege by default, with an approvals inbox,
  daemon-enforced budgets, secret redaction, and a container sandbox tier.
- **Autonomy.** A classed planner, cost-aware routing, verification
  gates, a learning loop, durable schedules, and delegation.
- **Scale.** Plugins, a user service, compose, Helm, and a TCP runner
  transport.
- **Distribution.** Signed, self-contained bundles, npm packages with
  provenance, a signed container image, desktop installers, and SBOMs for
  everything.

## Upgrading from v0.x

- **No manual steps.** Point v1.0 at your existing `AEOS_HOME`. The release
  pipeline's `upgrade` job checks this: state written by the previous
  release and by `staging` is read and resumed, and the log stays clean.
  It has also been verified from `v0.1.0`.
- **Back up `AEOS_HOME` first.** Downgrades are not supported.
- **If you set `AEOS_API_TOKEN`:** only `/v1/*` needs the token. The web UI
  asks for it on first load.
- **Deprecations:** none.

## Verify your download

```bash
cosign verify-blob aeos-1.0.0-linux-x64.tar.gz \
  --bundle aeos-1.0.0-linux-x64.tar.gz.sigstore.json \
  --certificate-identity-regexp 'https://github.com/mirrorfolio-idea-labs/AEOS/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

_(Fill in at cut time: highlights since the last RC, and contributors.)_
