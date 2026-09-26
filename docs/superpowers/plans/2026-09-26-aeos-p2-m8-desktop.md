# AEOS P2.M8 — Tauri Desktop Wrapper

**Goal (spec §14, D4):** a thin native shell around the ADE that the daemon
serves. No UI logic is forked into the shell.

## Design

- `apps/desktop/` is a Tauri 2 app (Rust, `src-tauri/`). It is not part of
  `pnpm build`; its own `desktop` CI workflow builds it.
- **Lifecycle** (`daemon.rs`):
  1. Check `AEOS_URL` or `http://127.0.0.1:<AEOS_PORT|7777>/v1/health`.
  2. If nothing answers, spawn `AEOS_DAEMON_CMD`, or `aeosd` on PATH, and
     wait up to 30 s for it to become healthy.
  3. The shell **owns** only a daemon it started. On exit it sends SIGTERM,
     then SIGKILL after 5 s.
  4. Exit covers both closing the window and a termination signal. The
     signal case goes through `ctrlc` and `app.exit`. It was added after the
     GUI smoke showed that a SIGTERM to the shell orphaned the daemon.
- **Window.** It shows a local splash, then navigates to the ADE the daemon
  serves. The capability set is empty: the remote UI gets no IPC.
- **Notifications** (`links.rs`, `lib.rs`):
  - An SSE watcher on `/v1/events?typePrefix=agent.status_changed`
    reconnects forever.
  - `blocked` raises "X needs you", which opens `?agent=ws/x&tab=approvals`.
  - `done` raises "X finished".
  - Linux: clicking the notification opens the view (notify-rust default
    action).
  - macOS/Windows: the view opens and the app requests user attention.
- **Deep links.** `aeos://agent/<ws>/<agent>[/<tab>]` goes through the
  deep-link plugin, plus single-instance forwarding on Linux and Windows.
  Only slug-shaped IDs and known tabs are accepted.
- **ADE.** It reads `?agent=&tab=` on load (`readDeepLink` in `App.tsx`).
- **Icons.** Generated from a brand PNG with `tauri icon`.

## Verification

- `cargo test`:
  - links: deep-link parsing and rejection, and the accept test "approval
    notification opens the inbox view";
  - lifecycle: cold start when absent, reuse when present, SIGTERM clean stop
    (a marker proves it), and a clear error when the binary is missing.
- ADE Playwright T8: a deep link lands on the approvals tab, and a bogus tab
  falls back to the objective tab.
- Local release bundle: `AEOS_0.1.0_amd64.deb`, depending on webkit2gtk-4.1
  and gtk3.
- GUI smoke under Xvfb with the real `aeosd` (fake provider): the shell
  cold-started the daemon (`/v1/health` 200, ADE served). After SIGTERM to
  the shell, it logged "aeosd stopped" and health went dark.
- CI `desktop.yml`: ubuntu-22.04 builds deb and AppImage; macos-14 builds app
  and dmg. It runs the cargo tests and uploads the artifacts. Artifacts are
  unsigned; signing is P5.M3 and needs identities from Kabeer.

New dependencies (pre-approved "Tauri 2"):
- crates: `tauri` 2.11, `tauri-plugin-deep-link`,
  `tauri-plugin-single-instance`, `notify-rust`, `ureq`, `ctrlc`,
  `serde`/`serde_json`;
- npm devDependency: `@tauri-apps/cli` 2.11.5.

All are MIT or Apache-2.0.
