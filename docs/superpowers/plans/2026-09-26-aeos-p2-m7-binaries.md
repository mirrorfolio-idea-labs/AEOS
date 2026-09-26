# AEOS P2.M7 — Managed Harness Binaries Implementation Plan

> **For agentic workers:** task-by-task, in order. Full green bar
> (`pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm depcruise`)
> before every commit; the completing commit flips that ROADMAP checkbox.

**Goal:** pin and manage harness versions per agent with checksum
verification, keep a BYO-binary fallback, and gate capabilities by version
(spec §9 Conductor pattern, §17.2 mitigation). **No new dependencies:**
download uses global `fetch`, install uses the `npm` CLI already present
wherever Node is, and hashing uses `node:crypto`.

## Design

- **Pins** (`provider-core/src/binaries/pins.ts`): `(harness, version,
  package, bin, integrity)`. `integrity` is the npm registry SRI of the
  package tarball. The codex and opencode pins match the versions the
  recorded fixtures came from (0.149.1 and 1.18.23); claude pins 2.1.283.
- **Manager** (`binaries/manager.ts`):
  1. Download the tarball.
  2. Refuse it unless its bytes match the pin's SRI (`binary_integrity_mismatch`).
  3. Run `npm install <tgz>` into `<root>/<harness>/<version>.partial`, then
     atomically rename it into place.
  4. Seal the install by writing `aeos-install.json` with a content tree hash
     of `node_modules`.
  5. `verify` recomputes the hash and throws `binary_tampered` on any drift.
     Results are cached per process by executable size and mtime; `fresh`
     bypasses the cache.
- **Resolution** (`binaries/resolve.ts`), in precedence order:
  1. A pinned version resolves to the verified managed install only. A pin
     never falls back to PATH.
  2. Otherwise the BYO `harness.binaryPath`.
  3. Otherwise the harness's default name on PATH.

  BYO and PATH binaries are version-probed with `--version`.
- **Gates** (`binaries/gates.ts`): `CAPABILITY_GATES` holds data-driven
  minimums. `assertCapability` throws the typed `CapabilityVersionError`
  (`capability_version_unsupported`). `gateAdapter` lowers the advertised
  capabilities and refuses gated spawns, such as resume below the gate.
- **Wiring:**
  - `AgentConfig.harness.binaryPath` (additive; schemas regenerated).
  - An adapter option `resolveCommand`, called per spawn so that errors fail
    that spawn.
  - The daemon (`apps/aeosd/src/api-module.ts`) resolves and gates every
    real adapter.
  - CLI `aeos harness pins|list|install|verify`, plus
    `agent create --harness-version/--binary-path`.

## Tasks

- **T1** Binary manager, pins, resolution, daemon/CLI wiring.
  *Accept (tests in `provider-core/test/binaries.test.ts`):* a tampered
  binary is rejected, and the pinned version is used over PATH.
- **T2** BYO fallback and version-gated capabilities.
  *Accept:* a feature requiring version X is refused with a typed error when
  the pinned version is below X.

**Exit gate:** the CI job `pinned-harnesses` installs every pin from the
real registry, re-verifies each one, checks that `--version` matches, then
runs the three adapter conformance suites. Verified locally on 2026-09-26:
all three pins installed and sealed; `--version` printed `codex-cli
0.149.1`, `1.18.23` and `2.1.283 (Claude Code)`.
