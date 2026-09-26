# Changesets

Every user-visible change ships with a changeset. It records the semver bump
and a changelog line; `pnpm changeset` writes one interactively.

- All AEOS packages move together as a **fixed** version group. They are
  one product, and the version on npm equals the release tag.
- When changesets land on `develop`, the `changesets` workflow opens or
  updates a **"Version Packages"** PR. That PR bumps the versions and
  writes the changelogs. Merging it and promoting the result through
  Gate 2 and Gate 3 is how a release is cut. The `vX.Y.Z` tag on `main`
  then triggers `release.yml`.
- The rules for which bump a change needs are in
  `docs/compatibility.md`.
