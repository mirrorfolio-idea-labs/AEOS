# Third-party notice — herdr detection manifests

`claude.toml`, `codex.toml` and `opencode.toml` in this directory are copied
from [herdr](https://github.com/herdrdev/herdr) (`src/detect/manifests/`,
commit `81ddfc65b4661c52569f8b8d1ee41d5a6d68f85e`), Copyright herdr
contributors. They are licensed under the Apache License, Version 2.0 — the
full text is in `LICENSE-herdr` next to this file.

**Changes made for AEOS:** each file gains a three-line comment header naming
its origin. The rule content is unchanged. The TypeScript rule engine that
evaluates them (`packages/runner/src/detect/`) is an independent
reimplementation of herdr's documented rule semantics, not a copy of its
Rust source.

Local overrides go in `<AEOS_HOME>/agent-detection/<harness>.toml`. They
replace the bundled manifest for that harness, following herdr's override
convention.
