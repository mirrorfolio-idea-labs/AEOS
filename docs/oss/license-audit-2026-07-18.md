# Dependency License Audit — 2026-07-18

- **Task:** AEOS-P5.M1.T3
- **Project license:** MIT ([ADR-001](../adr/ADR-001-license-mit.md))
- **Method:** `pnpm licenses list --json` over the full workspace (direct + transitive, prod + dev)
- **Regenerate:** `pnpm licenses list --json` and compare against this report

## Result: PASS — 139 packages, zero copyleft

All licenses found are MIT-compatible permissive licenses. No GPL, LGPL,
AGPL, MPL, or other copyleft license appears anywhere in the dependency
tree, so no `NOTICE` file is required and no license conflicts exist.

| License | Packages |
|---|---|
| MIT | 119 |
| ISC | 11 |
| Apache-2.0 | 4 |
| BSD-3-Clause | 3 |
| (MIT OR WTFPL) | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |
| **Total** | **139** |

## Full package list

### (BSD-2-Clause OR MIT OR Apache-2.0) (1)

`rc@1.2.8`

### (MIT OR WTFPL) (1)

`expand-template@2.0.3`

### Apache-2.0 (4)

`detect-libc@2.1.2`, `expect-type@1.4.0`, `tunnel-agent@0.6.0`, `typescript@5.6.3`

### BSD-3-Clause (3)

`fast-uri@3.1.3`, `ieee754@1.2.1`, `source-map-js@1.2.1`

### ISC (11)

`chownr@1.1.4`, `graceful-fs@4.2.11`, `inherits@2.0.4`, `ini@1.3.8/4.1.1`, `once@1.4.0`, `picocolors@1.1.1`, `semver@7.8.5`, `siginfo@2.0.0`, `wrappy@1.0.2`, `yaml@2.9.0`, `zod-to-json-schema@3.25.2`

### MIT (119)

`@esbuild/linux-x64@0.21.5/0.28.1`, `@jridgewell/sourcemap-codec@1.5.5`, `@rollup/rollup-linux-x64-gnu@4.62.2`, `@rollup/rollup-linux-x64-musl@4.62.2`, `@types/better-sqlite3@7.6.13`, `@types/estree@1.0.9`, `@types/node@22.20.1`, `@vitest/expect@2.1.9`, `@vitest/mocker@2.1.9`, `@vitest/pretty-format@2.1.9`, `@vitest/runner@2.1.9`, `@vitest/snapshot@2.1.9`, `@vitest/spy@2.1.9`, `@vitest/utils@2.1.9`, `acorn-jsx-walk@2.0.0`, `acorn-jsx@5.3.2`, `acorn-loose@8.5.2`, `acorn-walk@8.3.5`, `acorn@8.17.0`, `ajv@8.20.0`, `ansi-styles@4.3.0`, `assertion-error@2.0.1`, `base64-js@1.5.1`, `better-sqlite3@11.10.0`, `bindings@1.5.0`, `bl@4.1.0`, `buffer@5.7.1`, `cac@6.7.14`, `chai@5.3.3`, `chalk@4.1.2`, `check-error@2.1.3`, `color-convert@2.0.1`, `color-name@1.1.4`, `commander@13.1.0`, `debug@4.4.3`, `decompress-response@6.0.0`, `deep-eql@5.0.2`, `deep-extend@0.6.0`, `dependency-cruiser@16.10.4`, `end-of-stream@1.4.5`, `enhanced-resolve@5.24.2`, `es-errors@1.3.0`, `es-module-lexer@1.7.0`, `esbuild@0.21.5/0.28.1`, `estree-walker@3.0.3`, `fast-deep-equal@3.1.3`, `file-uri-to-path@1.0.0`, `fs-constants@1.0.0`, `function-bind@1.1.2`, `github-from-package@0.0.0`, `global-directory@4.0.1`, `has-flag@4.0.0`, `hasown@2.0.4`, `ignore@7.0.6`, `interpret@3.1.1`, `is-core-module@2.16.2`, `is-installed-globally@1.0.0`, `is-path-inside@4.0.0`, `json-schema-traverse@1.0.0`, `json5@2.2.3`, `kleur@3.0.3`, `loupe@3.2.1`, `magic-string@0.30.21`, `memoize@10.2.0`, `mimic-function@5.0.1`, `mimic-response@3.1.0`, `minimist@1.2.8`, `mkdirp-classic@0.5.3`, `ms@2.1.3`, `nanoid@3.3.16`, `napi-build-utils@2.0.0`, `node-abi@3.94.0`, `path-parse@1.0.7`, `pathe@1.1.2`, `pathval@2.0.1`, `picomatch@4.0.5`, `postcss@8.5.18`, `prebuild-install@7.1.3`, `prompts@2.4.2`, `pump@3.0.4`, `readable-stream@3.6.2`, `rechoir@0.8.0`, `regexp-tree@0.1.27`, `require-from-string@2.0.2`, `resolve@1.22.12`, `rollup@4.62.2`, `safe-buffer@5.2.1`, `safe-regex@2.1.1`, `simple-concat@1.0.1`, `simple-get@4.0.1`, `sisteransi@1.0.5`, `stackback@0.0.2`, `std-env@3.10.0`, `string_decoder@1.3.0`, `strip-bom@3.0.0`, `strip-json-comments@2.0.1`, `supports-color@7.2.0`, `supports-preserve-symlinks-flag@1.0.0`, `tapable@2.3.3`, `tar-fs@2.1.5`, `tar-stream@2.2.0`, `teamcity-service-messages@0.1.14`, `tinybench@2.9.0`, `tinyexec@0.3.2`, `tinypool@1.1.1`, `tinyrainbow@1.2.0`, `tinyspy@3.0.2`, `tsconfig-paths-webpack-plugin@4.2.0`, `tsconfig-paths@4.2.0`, `tsx@4.23.0`, `ulid@2.4.0`, `undici-types@6.21.0`, `util-deprecate@1.0.2`, `vite-node@2.1.9`, `vite@5.4.21`, `vitest@2.1.9`, `watskeburt@4.2.3`, `why-is-node-running@2.3.0`, `zod@3.25.76`
