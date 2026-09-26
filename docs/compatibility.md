# Versioning and compatibility

AEOS is one product. Every published package (`@aeos/*`, `create-aeos-plugin`)
carries the **same version**, and that version equals the release tag
(`vX.Y.Z`). This page states what each kind of version bump promises.
Maintainers are held to it by CI (schema and OpenAPI drift tests) and by
changesets review.

## Semantic versioning

The versioned surface covers four things:

- the published packages' public entry points;
- the HTTP API (`/v1`, described by `packages/api/openapi.json`);
- the on-disk layout of `AEOS_HOME`;
- the plugin ABI.

| Change | Bump |
|---|---|
| Bug fix; behaviour a test already defined | **patch** |
| New feature; new optional field, endpoint, event type, CLI command or plugin kind | **minor** |
| Removed or renamed field, endpoint, event, CLI flag or package export; stricter validation of existing input; an `AEOS_HOME` layout change without automatic migration | **major** |

Before 1.0, minor releases could still break things. From `v1.0.0` on, the
table above binds.

## Contracts: the stability core

`@aeos/contracts` defines the event envelope, domain objects, the event
taxonomy and the plugin manifest. It is published as Zod schemas and as JSON
Schema (`packages/contracts/schemas/*.json`), and it carries the strongest
guarantees:

- **Additive by default.** New fields are optional. New event types extend
  the taxonomy. Consumers must ignore fields and event types they don't know.
  AEOS's own readers are written that way.
- **The JSON Schemas are the published contract.** They are regenerated and
  drift-tested in CI on every change, so any schema change is visible in
  review.
- **A breaking contracts change is a major release.** It needs an ADR and
  explicit maintainer sign-off (see `docs/RELEASE.md` escalation triggers).
- **The event envelope's `v` field** (`PROTOCOL_VERSION`) only changes with a
  major release, and the runner protocol negotiates the highest version both
  sides support.

## Plugin ABI

Plugins declare the ABI range they were built for (`aeos.contract` in their
`package.json`, for example `"^1"`). AEOS refuses to load a plugin whose
range doesn't include its `PLUGIN_ABI_VERSION`, and the error names the
reason (`contract_mismatch`).

| `PLUGIN_ABI_VERSION` bump | Meaning for plugin authors |
|---|---|
| minor (`1.0` → `1.1`) | New optional capabilities. Plugins built for `^1` keep working. |
| major (`1.x` → `2.0`) | Something a plugin relied on changed shape. Rebuild against the new range. |

The plugin ABI version is independent of the AEOS release version. Most
AEOS releases do not change it.

## Your data (`AEOS_HOME`)

AEOS state is plain files: agents, memory, plans, checkpoints and
transcripts.

- **Upgrades never require manual file edits within a major version.** When
  a minor release changes the layout, it migrates on first boot and keeps
  what it can't migrate.
- **Downgrades are not supported.** Back up `AEOS_HOME` before upgrading,
  especially across a major version.
- The SQLite index (`index.db`) is derived data. `aeosd reindex` rebuilds it
  from the files at any time.

## Support window

| Line | Receives |
|---|---|
| Latest minor of the current major | Fixes and security patches |
| Previous minor of the current major | Security patches for 90 days after the next minor ships |
| Previous major | Security patches for 6 months after the next major ships |

Report vulnerabilities privately (see `SECURITY.md`); don't open public
issues for them.

## Deprecations

Deprecated behaviour keeps working for at least one minor release, and it
warns (in CLI output or the daemon log) before it is
removed in the next major. Every deprecation is listed in the changelog of
the release that introduced it.
