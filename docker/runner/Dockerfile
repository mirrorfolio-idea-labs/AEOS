# AEOS container sandbox tier (P4.M1, spec §10) — the runtime a harness runs
# in when policy puts a task in `sandbox.tier: container`.
#
# Harness binaries are NOT baked in: AEOS mounts the host's pinned, hash-
# verified managed install (`aeos harness install`) or BYO binary read-only,
# so the image stays harness-agnostic and version pins keep one source of
# truth. The image only supplies the runtime those harnesses need.
#
# Build: `aeos sandbox build` (tags aeos-runner:local) or
#        docker build -t aeos-runner:local docker/runner
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep openssh-client \
 && rm -rf /var/lib/apt/lists/*

# harnesses run as the host uid (--user); make git accept worktrees owned by it
RUN git config --system --add safe.directory '*'

LABEL org.opencontainers.image.title="aeos-runner" \
      org.opencontainers.image.description="AEOS container sandbox tier runtime" \
      org.opencontainers.image.licenses="MIT"
