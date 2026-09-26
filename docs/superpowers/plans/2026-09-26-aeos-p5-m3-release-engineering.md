# AEOS P5.M3 — Release Engineering

## Design
- **T1 — Changesets** (`@changesets/cli`, pre-approved).
  - All publishable packages are one **fixed** group: one product version,
    equal to the tag. The private UI apps are ignored.
  - Package versions are aligned with the product line at 0.3.0. The P4
    changeset makes the Version PR bump them to **0.4.0**, matching
    v0.4.0 (checked with `changeset status --verbose`).
  - `changesets.yml` runs on pushes to `develop` and keeps one "Version
    Packages" PR open, which bumps versions and writes CHANGELOGs.
  - Publish metadata was added to every publishable package: `files`,
    `repository.directory`, and public access with npm provenance.
  - `@aeos/cli` is now publishable. `@aeos/aeosd` stays npm-private: the
    daemon ships as bundles and the image, because node-pty would force
    every user's install to compile a native module.
- **T2 — `release.yml`.** Triggered by a `v*.*.*` tag, with a dry run on
  `workflow_dispatch` and on PRs that touch the pipeline.
  1. `verify` runs the full CI chain. On a tag it also checks that the tag
     equals the package version.
  2. `bundles` (linux-x64, macos-arm64) builds
     `scripts/release/bundle.mjs`: a **self-contained** tarball with aeosd
     and the CLI (`pnpm deploy --prod`), the web UI, the Node runtime and
     launchers. Git is the only host requirement. The job then
     **smoke-tests the extracted bundle** with a minimal `PATH`.
  3. `npm-packages` runs `pnpm pack` for every publishable package, with
     `workspace:` dependencies rewritten to real versions.
  4. `desktop` produces the Tauri installers. It calls `desktop.yml`, which
     is now reusable through `workflow_call`.
  5. `sign-and-release` has three parts:
     - A syft SPDX SBOM for every artifact, plus `SHA256SUMS`.
     - On a tag only: cosign keyless signatures (bundles, installers,
       checksums), because keyless signing writes to the *public* Rekor
       log and a dry run of a private repo must not publish anything.
     - On a tag: the GHCR image is pushed, signed and given an SBOM
       attestation; a GitHub Release is created (prerelease for `-rc`)
       with `notes/release-<tag>.md`; and npm publish runs with
       provenance when `NPM_TOKEN` is set.
- **T3 — policy.**
  - `docs/compatibility.md` covers semver per surface, contracts
    guarantees, plugin-ABI bumps, `AEOS_HOME` migrations and downgrades,
    the support window and deprecations. It is published on the docs site
    (the `guides/compatibility` page in the P5.M2 sync map).
  - `packages/contracts/README.md` states that package's guarantees.

## Verification
- All workflows are **actionlint**-clean (actionlint built via the Go
  module proxy).
- `changeset status --verbose` shows every package going to 0.4.0.
- Bundle: built locally (linux-x64, 77 MB), extracted to a clean directory
  and run under `env -i PATH=/usr/bin:/bin`. The daemon started, the CLI
  worked, an objective completed through `aeos approvals approve`, and the
  web UI served a 200.
- `pnpm pack` for all 17 publishable packages: `dist` only, internal
  dependencies pinned to 0.3.0.
- **Manual (Kabeer):**
  - one-time repo settings (Actions may create PRs; Pages; the `NPM_TOKEN`
    secret);
  - pushing the `v1.0.0-rc.1` tag (Gate 3), which is T2's accept test;
  - OS code-signing identities for the installers.

  The guide is in `guides/`. T2 stays `[~]` until the RC is cut from a tag.
