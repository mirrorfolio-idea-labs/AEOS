# AEOS daemon image (P4.M3.T2, spec §16 "Docker" target) — aeosd + the ADE
# web UI + the `aeos` CLI. State lives in the /data volume (AEOS_HOME).
#
#   docker compose up -d          # see compose.yaml at the repo root
#
# Build context: the repository root.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22-slim
# git: agents work in git worktrees; ca-certificates: model APIs over TLS
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
WORKDIR /app
COPY --from=build /app /app
RUN ln -s /app/apps/cli/dist/main.js /usr/local/bin/aeos && chmod +x /app/apps/cli/dist/main.js \
 && ln -s /app/apps/aeosd/dist/main.js /usr/local/bin/aeosd && chmod +x /app/apps/aeosd/dist/main.js \
 && useradd --create-home --uid 10001 aeos && mkdir -p /data && chown aeos:aeos /data
USER aeos
ENV AEOS_HOME=/data \
    AEOS_HOST=0.0.0.0 \
    AEOS_PORT=7777 \
    AEOS_UI_DIR=/app/apps/ade/dist \
    NODE_ENV=production
VOLUME ["/data"]
EXPOSE 7777
HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:7777/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/apps/aeosd/dist/main.js", "run"]
