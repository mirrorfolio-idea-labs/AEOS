# AEOS v1.0.0-rc.1 — release candidate

The first release candidate for AEOS 1.0. It is built, signed and
upgrade-tested entirely by CI from this tag (P5.M3.T2). The rc is published
as a GitHub pre-release and to npm under the `next` dist-tag, so `latest`
stays on v0.4.0.

**Please test it and report anything broken.** Release-blocking P0 and P1
issues are triaged per CONTRIBUTING, and `v1.0.0` ships once the public
beta exit gate (P5.M4) is met with no known P0 or P1 open.

Since v0.4.0: the version line goes to 1.0 and there is no breaking
change. The Arch Linux package now builds this tag
(`packaging/arch/PKGBUILD`, `pkgver=1.0.0rc1`).

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
cosign verify-blob aeos-1.0.0-rc.1-linux-x64.tar.gz \
  --bundle aeos-1.0.0-rc.1-linux-x64.tar.gz.sigstore.json \
  --certificate-identity-regexp 'https://github.com/mirrorfolio-idea-labs/AEOS/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
