# AEOS P4.M4 — TCP Runner Transport + Kubernetes

## Design (spec §10, §16)

### T1 — authenticated TCP transport
- New module `runner/src/protocol/transport.ts` defines the endpoint as
  `unix` | `tcp`. The framed protocol, the handshake and replay are
  unchanged.
- TCP uses **TLS 1.2 with a pre-shared key** (TLS-PSK, AEAD suites only):
  - **Mutual authentication.** Each side proves the per-session key during
    the handshake; a wrong key or wrong identity never completes.
  - Encrypted traffic, with no certificate authority to run or rotate.
  - The PSK identity is the session id, and the protocol's `hello` still
    checks the session id (a right key with a wrong session gets
    `wrong_session`).
  - Checked first that node 22's `pskCallback` works on both ends.
- Key handling:
  - The supervisor makes a fresh 32-byte key per session and writes it to
    `<session>/runner.psk` (mode 0600).
  - The runner reads it from that file, so the key never appears in argv
    (asserted through `/proc/<pid>/cmdline`) or in `session.yaml`.
- The runner binds an ephemeral port and publishes `tcp://host:port` to
  `<session>/runner.endpoint`. The supervisor records that endpoint in the
  existing `SessionRecord.runnerSocket` field, so **contracts are
  unchanged**.
- Adoption and connection resolve the endpoint string together with the
  key file.
- Found and fixed along the way: handling the TLS server's
  `tlsClientError` event suppresses node's default socket teardown, so a
  hostile client could have held connections open. The handler now
  destroys the socket.
- Daemon settings: `AEOS_RUNNER_TRANSPORT=tcp` and `AEOS_RUNNER_HOST`.

### T2 — Helm chart
- `deploy/helm/aeos` contains:
  - a **single-replica** Deployment with `strategy: Recreate`, because file
    state allows only one writer;
  - a `ReadWriteOnce` PVC for `/data`;
  - a token Secret, generated once and kept across upgrades through
    `lookup` plus `resource-policy: keep`, or supplied via
    `existingSecret`;
  - a provider-keys Secret passed through `envFrom`;
  - a non-root pod with a read-only root filesystem, all capabilities
    dropped, the RuntimeDefault seccomp profile and `HOME` on the volume;
  - `/healthz` probes, a Service, an optional Ingress and NOTES.txt.
- CI:
  - `helm-lint` (lint + template) runs on every PR.
  - `nightly-k8s.yml` runs nightly, on demand, and on PRs that touch the
    chart or image. It builds the image, `kind load`s it and runs
    `helm install --wait`. It then runs the golden-path smoke through the
    Service, and finally checks that `helm upgrade` keeps both the token
    and the data.

## Verification
- **T1 accept:** the P1.M3 re-adoption flagship (daemon death → zero event
  loss) and the whole supervisor suite run over **both** unix and TCP
  (`describe.each`).
- `tcp-transport.test.ts`:
  - endpoint and key-file hygiene; replay over TLS;
  - mutual auth: a wrong key, a wrong identity, plain TCP and a wrong
    session are all refused, and the runner survives;
  - a **wire fuzz over the TLS stream** (20 rounds of garbage and invalid
    frames at random chunk boundaries) never kills the runner.
- 10/10 runs of the TCP suite are stable. One test fix was needed: the
  plain-TCP probe must drain the TLS alert before `close` can fire.
- T2 locally: helm was built from source through the Go module proxy
  (get.helm.sh is blocked by egress); `helm lint` and `helm template` are
  clean. A local `kind` cluster cannot start a kubelet in this sandbox
  (cgroups), so the real-cluster proof is the `nightly-k8s` job, which also
  runs on this PR.
