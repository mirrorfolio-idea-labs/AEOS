# AEOS P4.M3 — Deploy Targets

## Design (spec §16)

- **T1 — `aeos service install|uninstall|status`**
  (`apps/cli/src/service.ts`).
  - Linux gets a systemd **user** unit (`Restart=on-failure`,
    `WantedBy=default.target`, plus `loginctl enable-linger` so it runs
    after logout and at boot).
  - macOS gets a LaunchAgent (`RunAtLoad`, `KeepAlive` on failure, logs in
    `<home>/logs`).
  - Both stop **only the daemon**: `KillMode=process` and
    `AbandonProcessGroup`. Detached runners survive daemon restarts by
    design (spec §10), and the default kill-the-group behaviour would turn
    every restart into a runner crash.
  - Values are quoted/escaped per format. The token is passed as a file
    path, never a value. `--dry-run` prints the plan.
- **T2 — docker compose.** `docker/aeosd/Dockerfile` builds a multi-stage
  image: aeosd, the ADE and the `aeos` CLI.
  - It runs as non-root uid 10001 under tini.
  - `/data` is `AEOS_HOME`, and a `/healthz` HEALTHCHECK is built in.
  - `compose.yaml` passes the token as a compose secret
    (`AEOS_API_TOKEN_FILE`) and publishes on loopback by default.
  - `docker/compose-smoke.mjs` is the quickstart smoke; CI runs it in the
    `compose-quickstart` job.
- **T3 — remote posture.** The token gate, previously on every route, is
  now:
  - `/v1/*` only. The ADE shell must load to ask for the token.
  - A constant-time comparison.
  - `?token=` accepted only on the event stream and terminal attach
    (browsers cannot set headers there).
  - An unauthenticated `/healthz` returning only `{status:"ok"}`.
  - `AEOS_API_TOKEN_FILE` support.

  The ADE gets a sign-in form shown on a 401, a "token rejected" state and
  a one-time `#token=` link, which is stripped from the URL. Found while
  building this: a token-protected daemon could not serve its own UI at
  all.

  `docs/deploy.md` covers the Caddy and nginx TLS recipes.

## Verification
- `cli/test/service.test.ts` (5 tests): unit/plist golden checks, quoting
  and escaping, per-platform plans, and `systemd-analyze verify` on the
  unit (also run by hand on the rendered unit: exit 0).
- `api/test/api.test.ts`, **T3 accept**: over a real **non-loopback**
  socket, unauthenticated, wrong-token and wrong-route-query-token
  requests all get 401; the right token gets 200; the SSE `?token=` works;
  `/healthz` stays open and reveals nothing.
- ADE Playwright T10 against a token-protected daemon: the API is 401 while
  the shell loads; the form appears; a wrong token is rejected; the right
  token works; the `#token=` link signs in and is stripped. The full ADE
  suite passes 11/11.
- **T2 accept:** the `compose-quickstart` CI job runs
  `docker compose up --build --wait` and then the smoke (401s, UI served,
  objective completed). Locally, the image build is blocked by egress (apt
  403). The smoke passed against the same runtime layout: stock node:22,
  uid 10001, read-only `/app`, compose env, and the token file.
- **Manual (Kabeer):** a real logout/reboot on Linux and macOS (T1), and
  TLS on a VM (T3). Step-by-step guide:
  `guides/2026-09-26-p4-m3-service-reboot-and-tls-vm.md`. T1 and T3 stay
  `[~]` until they are signed off.
