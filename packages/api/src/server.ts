import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import websocket from '@fastify/websocket';
import { openIndexDb, type EventBus, type IndexDb } from '@aeos/kernel';
import type { AgentConfig, CredentialProfile, EffectivePolicy, ProviderId } from '@aeos/contracts';
import type { HarnessAdapter } from '@aeos/provider-core';
import type { ApprovalsRegistry, SandboxChoice } from '@aeos/policy';
import type { LoadedPricing } from '@aeos/router';
import { ApiError, sendError } from './envelope.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerObjectiveRoutes } from './routes/objectives.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerRuntimeRoutes } from './routes/runtime.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerEventRoutes } from './routes/events.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerAttachRoute } from './routes/attach.js';
import { attachNotifier } from './notify.js';
import { statusTrackerFor } from './status.js';

/** Daemon-side PTY handle for one takeover session (P2.M5). */
export interface PtyHandle {
  input(data: string): void;
  resize(cols: number, rows: number): void;
  /** Tears the takeover shell down — release returns the session to headless. */
  release(): void;
}

/**
 * Resolves a live session's runner PTY. Dependency-inverted: the API package
 * defines the seam, the daemon (supervisor) supplies it.
 */
export type PtyBridge = (
  sessionId: string,
  onOutput: (data: string) => void,
) => Promise<PtyHandle>;

export interface ApiServerOptions {
  /** AEOS_HOME — the file tree is truth; the API is a view over it. */
  home: string;
  /**
   * Adapter factory per agent — the daemon wires real providers; tests wire
   * the fake. `provider` is the router's choice for a task class (P3.M2);
   * absent means the agent's own harness.
   */
  /**
   * `sandbox` (P4.M1): the tier the task runs in — a `container` choice must
   * come back as an adapter whose harness runs inside that container.
   */
  adapterFor: (
    agent: AgentConfig,
    opts?: { provider?: ProviderId; sandbox?: SandboxChoice },
  ) => HarnessAdapter;
  /**
   * Pricing index for token-derived USD (P3.M2). Defaults to the cached or
   * static index without touching the network; the daemon refreshes daily.
   */
  pricing?: () => Promise<LoadedPricing>;
  /** Resolves an agent's credential profile id to the full profile. */
  credentialFor: (agent: AgentConfig) => CredentialProfile;
  /** Live event bus (kernel). Optional — without it, /v1/events serves backfill only. */
  bus?: EventBus;
  /** Bearer token; REQUIRED when binding beyond loopback (spec §14). */
  token?: string;
  /**
   * Resolves an agent's effective policy (spec §11 layered YAML). When
   * present, every session stream is daemon-side enforced.
   */
  policyFor?: (agent: AgentConfig) => Promise<EffectivePolicy>;
  /** Shared approvals inbox backing POST /v1/approvals/:requestId. */
  approvals?: ApprovalsRegistry;
  /**
   * Resolves an agent's declared secret refs to runner-env entries
   * (spec §11 injection). Consulted only under `secrets_access: allow`.
   */
  injectSecrets?: (agent: AgentConfig) => Promise<Record<string, string>>;
  /** Session id → owning agent (for policy checks on session-scoped routes). */
  resolveAgent?: (sessionId: string) => AgentConfig | undefined;
  /** Live-runner PTY bridge for `/v1/sessions/:id/attach` (P2.M5). */
  attachPty?: PtyBridge;
  /**
   * Attention push to `<home>/notifications.yaml` webhooks (P2.M10).
   * On by default; tests inject `fetchImpl` or pass `false`.
   */
  notify?: false | { fetchImpl?: typeof fetch; onError?: (error: unknown, url: string) => void };
}

export interface ApiContext extends ApiServerOptions {
  db: IndexDb;
}

export async function createApiServer(opts: ApiServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const ctx: ApiContext = { ...opts, db: openIndexDb(opts.home) };

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'AEOS API',
        description:
          'Local-first API over the AEOS daemon. Envelope: { success, data, error, meta }.',
        version: '0.1.0',
      },
    },
  });
  // WebSocket only for PTY attach (spec §14) — SSE carries everything else
  await app.register(websocket);

  app.setErrorHandler((error, _request, reply) => sendError(reply, error));

  if (opts.token !== undefined) {
    const expected = Buffer.from(opts.token);
    // constant-time compare: a token must not be guessable byte by byte
    const matches = (candidate: string | null | undefined): boolean => {
      if (candidate === null || candidate === undefined) return false;
      const given = Buffer.from(candidate);
      return given.length === expected.length && timingSafeEqual(given, expected);
    };
    app.addHook('onRequest', (request, reply, done) => {
      const url = new URL(request.url, 'http://localhost');
      // only the API is protected: the ADE shell (static assets) carries no
      // data and must load so it can ask for the token; /healthz is a bare
      // liveness probe for proxies and orchestrators
      if (!url.pathname.startsWith('/v1/')) {
        done();
        return;
      }
      // Browsers cannot set headers on WebSocket upgrades or EventSource —
      // the attach and event-stream routes additionally accept ?token=
      const queryAllowed = (url.pathname.startsWith('/v1/sessions/') && url.pathname.endsWith('/attach')) || url.pathname === '/v1/events';
      const bearer = request.headers.authorization?.startsWith('Bearer ') === true ? request.headers.authorization.slice(7) : undefined;
      if (matches(bearer) || (queryAllowed && matches(url.searchParams.get('token')))) {
        done();
        return;
      }
      sendError(reply, new ApiError(401, 'missing or invalid bearer token'));
    });
  }

  app.get('/healthz', {
    schema: { hide: true },
    handler: () => ({ status: 'ok' }),
  });

  app.get('/v1/health', {
    schema: {
      response: { 200: { type: 'object', additionalProperties: true } },
      description: 'Liveness + AEOS_HOME identity.',
    },
    handler: () => ({ success: true, data: { status: 'ok', home: opts.home }, error: null }),
  });

  registerWorkspaceRoutes(app, ctx);
  registerAgentRoutes(app, ctx);
  registerObjectiveRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
  registerRuntimeRoutes(app, ctx);
  registerJobRoutes(app, ctx);
  registerMemoryRoutes(app, ctx);
  registerEventRoutes(app, ctx);
  registerApprovalRoutes(app, ctx);
  registerAttachRoute(app, ctx);

  const detachNotifier =
    opts.notify === false
      ? () => undefined
      : attachNotifier({
          home: opts.home,
          tracker: statusTrackerFor(opts.home, opts.bus),
          ...(opts.notify?.fetchImpl === undefined ? {} : { fetchImpl: opts.notify.fetchImpl }),
          ...(opts.notify?.onError === undefined ? {} : { onError: opts.notify.onError }),
        });

  app.addHook('onClose', (_instance, done) => {
    detachNotifier();
    ctx.db.close();
    done();
  });
  return app;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Listen guard (spec §14): binding beyond loopback without a token is a
 * refusal, not a warning.
 */
export async function listenApi(
  app: FastifyInstance,
  opts: { host?: string; port: number; token?: string },
): Promise<string> {
  const host = opts.host ?? '127.0.0.1';
  if (!LOOPBACK.has(host) && opts.token === undefined) {
    throw new ApiError(400, `refusing to bind ${host} without AEOS_API_TOKEN (spec §14)`);
  }
  return app.listen({ host, port: opts.port });
}
