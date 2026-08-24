import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import { openIndexDb, type EventBus, type IndexDb } from '@aeos/kernel';
import type { AgentConfig, CredentialProfile, EffectivePolicy } from '@aeos/contracts';
import type { HarnessAdapter } from '@aeos/provider-core';
import type { ApprovalsRegistry } from '@aeos/policy';
import { ApiError, sendError } from './envelope.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerObjectiveRoutes } from './routes/objectives.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerEventRoutes } from './routes/events.js';
import { registerApprovalRoutes } from './routes/approvals.js';

export interface ApiServerOptions {
  /** AEOS_HOME — the file tree is truth; the API is a view over it. */
  home: string;
  /** Adapter factory per agent — the daemon wires real providers; tests wire the fake. */
  adapterFor: (agent: AgentConfig) => HarnessAdapter;
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

  app.setErrorHandler((error, _request, reply) => sendError(reply, error));

  if (opts.token !== undefined) {
    const token = opts.token;
    app.addHook('onRequest', (request, reply, done) => {
      if (request.headers.authorization === `Bearer ${token}`) {
        done();
        return;
      }
      sendError(reply, new ApiError(401, 'missing or invalid bearer token'));
    });
  }

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
  registerMemoryRoutes(app, ctx);
  registerEventRoutes(app, ctx);
  registerApprovalRoutes(app, ctx);

  app.addHook('onClose', (_instance, done) => {
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
