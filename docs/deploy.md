# Deploying AEOS

The daemon, contracts and state layout are the same on every target; only
where the process runs changes (spec §16). Pick one:

| Target | Use when | Command |
|---|---|---|
| [Your machine, as a service](#1-your-machine-as-a-user-service) | A laptop or workstation; you want AEOS always on | `aeos service install` |
| [Docker Compose](#2-docker-compose) | A home server or VM; one command | `docker compose up -d` |
| [Remote access](#3-remote-access-token--tls) | Using the web UI from another device | token + reverse proxy |
| [Kubernetes](#4-kubernetes-helm) | A cluster you already run | `helm install aeos deploy/helm/aeos` |

All state lives in `AEOS_HOME` (default `~/.aeos`) as plain files. Back up
that directory and you have backed up AEOS.

## 1. Your machine, as a user service

```bash
aeos service install            # Linux: systemd user unit · macOS: LaunchAgent
aeos service status
aeos service uninstall
```

- It starts at login, restarts on failure, and listens on
  `http://127.0.0.1:7777` (loopback only, so no token is needed).
- **Linux:** to keep AEOS running after you log out, and to start it at
  boot, run `loginctl enable-linger $USER`. The installer tries this for
  you; it may need admin rights.
- `--dry-run` prints the unit and commands without changing anything.
- `--aeosd /path/to/aeosd/dist/main.js` is needed when `aeosd` is not on
  your `PATH`.
- Coding sessions run in detached runner processes, and those survive a
  daemon restart. The service is set to stop only the daemon
  (`KillMode=process` on systemd, `AbandonProcessGroup` on launchd), so an
  upgrade or crash never kills in-flight work.

## 2. Docker Compose

From a checkout of this repository:

```bash
mkdir -p secrets && openssl rand -hex 32 > secrets/aeos_api_token
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env        # and/or OPENAI_API_KEY; never commit .env
docker compose up -d
open http://localhost:7777                         # paste the token from secrets/aeos_api_token
```

- State lives in the `aeos-home` volume, mounted at `/data`.
- Inside the container, aeosd binds `0.0.0.0`, so token auth is mandatory.
  The token is read from the compose secret (`AEOS_API_TOKEN_FILE`), never
  from an environment variable.
- The published port defaults to `127.0.0.1:7777`. Set
  `AEOS_PUBLISH=0.0.0.0:7777` to expose it on your network, and put TLS in
  front first (section 3).
- Harness CLIs live in the volume:
  `docker compose exec aeosd aeos harness install claude-code@<version>`.
  Pinned versions are integrity-checked (see `aeos harness pins`).
- The quickstart is tested on every change by CI (`compose-quickstart`
  job).

**Container sandbox tier inside compose.** Per-task sandbox containers
(`sandbox.tier: container`) are siblings started through the host's docker
socket. They bind-mount worktree paths, and those paths must mean the same
thing to the host and to aeosd. To use the tier, mount the docker socket and
bind-mount `AEOS_HOME` at the same absolute path on both sides, for example
`/srv/aeos:/srv/aeos`, with `AEOS_HOME=/srv/aeos`. Mounting the docker socket
gives aeosd root-equivalent access to the host, so only do this on a machine
dedicated to AEOS.

## 3. Remote access: token + TLS

aeosd **refuses to bind a non-loopback address without a token**. Once a
token is set, every `/v1` API request needs `Authorization: Bearer <token>`,
and anything else gets `401`. Three things stay open without a token:

- the web UI shell, so it can ask for the token;
- `/healthz`, which returns only `{"status":"ok"}`;
- `?token=` on the two browser-streaming routes (the event stream and the
  terminal attach). Browsers cannot set headers on those.

```bash
export AEOS_API_TOKEN_FILE=/etc/aeos/token        # or AEOS_API_TOKEN=...
AEOS_HOST=127.0.0.1 aeosd run                      # keep aeosd on loopback …
```

… and terminate TLS in a reverse proxy in front of it. Two options:

**Caddy** (automatic HTTPS):

```caddyfile
aeos.example.com {
  reverse_proxy 127.0.0.1:7777 {
    flush_interval -1        # stream events (SSE) without buffering
  }
}
```

**nginx:**

```nginx
server {
  listen 443 ssl;
  server_name aeos.example.com;
  ssl_certificate     /etc/letsencrypt/live/aeos.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/aeos.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:7777;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;       # terminal takeover (WebSocket)
    proxy_set_header Connection "upgrade";
    proxy_buffering off;                          # event stream (SSE)
    proxy_read_timeout 1h;
  }
}
```

Open `https://aeos.example.com` and paste the token when asked. To hand
access to a device without typing the token, send it a one-time link:
`https://aeos.example.com/#token=<token>`. The fragment never reaches the
server, and the web UI removes it from the address bar right away.

Rotating the token means changing it and restarting aeosd; browsers then ask
for the new token.

## 4. Kubernetes (Helm)

```bash
kubectl create secret generic aeos-providers --from-literal=ANTHROPIC_API_KEY=sk-ant-...
helm install aeos deploy/helm/aeos --set providerSecret=aeos-providers
kubectl get secret aeos-token -o jsonpath='{.data.token}' | base64 -d; echo
kubectl port-forward svc/aeos 7777:7777          # or enable the Ingress (values.yaml)
```

- **One replica, on purpose.** All AEOS state is files on one volume, so
  the chart runs exactly one pod (`strategy: Recreate`) with a
  `ReadWriteOnce` PVC. To scale, run more releases, for example one per
  team.
- **Token.** It is generated once and kept across `helm upgrade`. You can
  also bring your own with `auth.existingSecret`.
- **Security.** The pod runs non-root (uid 10001) with a read-only root
  filesystem, all capabilities dropped and the RuntimeDefault seccomp
  profile. `HOME` is on the volume.
- **Tested nightly.** The nightly CI installs the chart on a `kind` cluster
  and runs the golden path through the Service
  (`.github/workflows/nightly-k8s.yml`). It also checks that an upgrade
  keeps the token and the data.

### Runners over TCP

Coding sessions normally run in runner processes that the daemon reaches
over a local Unix socket. To make runners reachable across hosts or pods,
set:

```bash
AEOS_RUNNER_TRANSPORT=tcp AEOS_RUNNER_HOST=<interface to bind and dial>
```

The framed runner protocol then runs over **TLS with a per-session
pre-shared key**:

- Both sides must prove the key; a wrong key never completes a handshake.
- Traffic is encrypted.
- There are no certificates to manage.
- The key lives only in a `0600` file next to the session. It never
  appears in process arguments or the session record.
