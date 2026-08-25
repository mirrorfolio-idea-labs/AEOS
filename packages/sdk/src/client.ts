import { AeosEventSchema, type AeosEvent, type AgentConfig, type Workspace } from '@aeos/contracts';

/** Mirror of the server envelope (spec §14). */
export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

export class AeosApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AeosApiError';
  }
}

export interface AeosClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface ObjectiveStatus {
  running: boolean;
  tasks: Array<{ id: string; title: string; status: string }>;
  checkpoints: Array<{ taskId: string; status: string; attempts: number }>;
}

export interface EventStreamOptions {
  typePrefix?: string;
  agentId?: string;
  sessionId?: string;
  workspaceId?: string;
  lastEventId?: string;
  signal?: AbortSignal;
}

export interface PendingApproval {
  requestId: string;
  sessionId: string;
  tier: string;
  detail: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

/** Thin typed client over the AEOS daemon API (generated types: src/generated/). */
export class AeosClient {
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: AeosClientOptions) {
    // bind: browsers require fetch to be invoked on globalThis (unbound
    // references throw "Illegal invocation" when called as this.fetch()).
    this.fetch = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    // Only set content-type when a body is actually sent — an empty payload
    // with a JSON content-type makes Fastify's body parser choke.
    const response = await this.fetch(`${this.opts.baseUrl}${url}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.opts.token === undefined ? {} : { authorization: `Bearer ${this.opts.token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = (await response.json()) as Envelope<T>;
    if (!response.ok || !envelope.success || envelope.data === null) {
      throw new AeosApiError(response.status, envelope.error ?? `request failed: ${url}`);
    }
    return envelope.data;
  }

  health(): Promise<{ status: string; home: string }> {
    return this.request('GET', '/v1/health');
  }

  createWorkspace(workspace: Workspace): Promise<Workspace> {
    return this.request('POST', '/v1/workspaces', workspace);
  }

  listWorkspaces(): Promise<Workspace[]> {
    return this.request('GET', '/v1/workspaces');
  }

  createAgent(agent: AgentConfig): Promise<AgentConfig> {
    return this.request('POST', '/v1/agents', agent);
  }

  getAgent(workspaceId: string, agentId: string): Promise<AgentConfig> {
    return this.request('GET', `/v1/agents/${agentId}?workspaceId=${workspaceId}`);
  }

  switchCredentialProfile(
    workspaceId: string,
    agentId: string,
    credentialProfileId: string,
  ): Promise<AgentConfig> {
    return this.request(
      'POST',
      `/v1/agents/${agentId}/credential-profile?workspaceId=${workspaceId}`,
      { credentialProfileId },
    );
  }

  createObjective(input: {
    workspaceId: string;
    agentId: string;
    id: string;
    title: string;
    tasks: Array<{ id: string; title: string }>;
  }): Promise<{ id: string }> {
    return this.request('POST', '/v1/objectives', input);
  }

  startObjective(workspaceId: string, agentId: string, objectiveId: string): Promise<{ started: boolean }> {
    return this.request(
      'POST',
      `/v1/objectives/${objectiveId}/start?workspaceId=${workspaceId}&agentId=${agentId}`,
      {},
    );
  }

  objectiveStatus(workspaceId: string, agentId: string, objectiveId: string): Promise<ObjectiveStatus> {
    return this.request(
      'GET',
      `/v1/objectives/${objectiveId}?workspaceId=${workspaceId}&agentId=${agentId}`,
    );
  }

  /** Kill switch (spec §18): stops all new session spawns; in-flight sessions finish. */
  stopAll(): Promise<{ stopped: boolean }> {
    return this.request('POST', '/v1/stop');
  }

  /** Lifts the kill switch (removes the STOP file). */
  resumeOps(): Promise<{ stopped: boolean }> {
    return this.request('DELETE', '/v1/stop');
  }

  stopStatus(): Promise<{ stopped: boolean }> {
    return this.request('GET', '/v1/stop');
  }

  /** Pending approval requests (spec §11 approvals flow). */
  async listApprovals(): Promise<PendingApproval[]> {
    const data = await this.request<{ pending: PendingApproval[] }>('GET', '/v1/approvals');
    return data.pending;
  }

  /** Answer a pending approval; unanswered requests deny on expiry. */
  resolveApproval(
    requestId: string,
    decision: 'approve' | 'deny',
  ): Promise<{ resolved: boolean; decision: string }> {
    return this.request('POST', `/v1/approvals/${requestId}`, { decision });
  }

  searchMemory(
    workspaceId: string,
    agentId: string,
    q: string,
    k = 10,
  ): Promise<Array<{ path: string; snippet: string }>> {
    return this.request(
      'GET',
      `/v1/memory/search?workspaceId=${workspaceId}&agentId=${agentId}&q=${encodeURIComponent(q)}&k=${k}`,
    );
  }

  /**
   * SSE reader over fetch streams (no runtime dependency). Yields parsed
   * canonical events; pass `lastEventId` to backfill after a reconnect.
   */
  async *events(opts: EventStreamOptions = {}): AsyncGenerator<AeosEvent> {
    const params = new URLSearchParams();
    for (const key of ['typePrefix', 'agentId', 'sessionId', 'workspaceId', 'lastEventId'] as const) {
      const value = opts[key];
      if (value !== undefined) params.set(key, value);
    }
    const response = await this.fetch(`${this.opts.baseUrl}/v1/events?${params.toString()}`, {
      headers: {
        ...(this.opts.token === undefined ? {} : { authorization: `Bearer ${this.opts.token}` }),
        ...(opts.lastEventId === undefined ? {} : { 'last-event-id': opts.lastEventId }),
      },
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    });
    if (!response.ok || response.body === null) {
      throw new AeosApiError(response.status, 'event stream unavailable');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          if (dataLine !== undefined) {
            const parsed = AeosEventSchema.safeParse(JSON.parse(dataLine.slice(6)));
            if (parsed.success) yield parsed.data;
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}
