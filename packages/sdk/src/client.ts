import {
  AeosEventSchema,
  type AeosEvent,
  type AgentConfig,
  type AgentStatus,
  type RepoBinding,
  type Workspace,
} from '@aeos/contracts';

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

export interface PlanTaskView {
  id: string;
  title: string;
  status: string;
  taskClass?: string;
  agent?: string;
}

export interface ObjectiveStatus {
  running: boolean;
  tasks: PlanTaskView[];
  checkpoints: Array<{ taskId: string; status: string; attempts: number; commit?: string }>;
  /** Planner proposal awaiting approval (P3.M1). */
  proposedTasks?: PlanTaskView[];
}

export type DiffScope = 'uncommitted' | 'branch' | 'last-commit';

export interface ObjectiveDiff {
  scope: DiffScope;
  branch: string;
  worktree: string;
  baseCommit: string;
  diff: string;
}

export interface ReviewComment {
  file?: string;
  line?: number;
  body: string;
}

export interface AgentStatusEntry {
  workspaceId: string;
  agentId: string;
  status: AgentStatus;
  seq: number;
  since: string;
  via: 'events' | 'screen';
  reason?: string;
  rule?: string;
  sessionId?: string;
}

export interface InboxItem extends AgentStatusEntry {
  name: string;
  unseen: boolean;
  settled: boolean;
  /** 0 blocked · 1 finished-unseen · 2 working · 3 idle/seen · 4 settled. */
  bucket: number;
}

export type AttentionAction = 'seen' | 'unread' | 'settle' | 'unsettle';

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

  /**
   * WebSocket URL for a session's PTY attach endpoint (spec §14 — WS only
   * for takeover). Auth rides the upgrade request via `token` query param
   * when configured (browsers cannot set headers on WebSocket).
   */
  attachUrl(sessionId: string): string {
    const base = this.opts.baseUrl === '' && typeof location !== 'undefined'
      ? location.origin
      : this.opts.baseUrl;
    const wsBase = base.replace(/^http/, 'ws');
    return this.opts.token === undefined
      ? `${wsBase}/v1/sessions/${sessionId}/attach`
      : `${wsBase}/v1/sessions/${sessionId}/attach?token=${encodeURIComponent(this.opts.token)}`;
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

  bindRepo(workspaceId: string, agentId: string, binding: RepoBinding): Promise<AgentConfig> {
    return this.request('POST', `/v1/agents/${agentId}/repos?workspaceId=${workspaceId}`, binding);
  }

  unbindRepo(workspaceId: string, agentId: string, repoId: string): Promise<AgentConfig> {
    return this.request('DELETE', `/v1/agents/${agentId}/repos/${repoId}?workspaceId=${workspaceId}`);
  }

  objectiveDiff(
    workspaceId: string,
    agentId: string,
    objectiveId: string,
    scope: DiffScope = 'branch',
  ): Promise<ObjectiveDiff> {
    return this.request(
      'GET',
      `/v1/objectives/${objectiveId}/diff?workspaceId=${workspaceId}&agentId=${agentId}&scope=${scope}`,
    );
  }

  agentStatus(workspaceId: string, agentId: string): Promise<AgentStatusEntry> {
    return this.request('GET', `/v1/agents/${agentId}/status?workspaceId=${workspaceId}`);
  }

  /**
   * Long-poll until the agent reaches one of `until`. Pass `afterSeq` from
   * a prior `agentStatus()` to require a NEW transition (act, then wait).
   */
  waitForAgent(
    workspaceId: string,
    agentId: string,
    opts: { until?: AgentStatus[]; timeoutMs?: number; afterSeq?: number } = {},
  ): Promise<{ matched: boolean; entry: AgentStatusEntry }> {
    const query = new URLSearchParams({ workspaceId });
    if (opts.until !== undefined) query.set('until', opts.until.join(','));
    if (opts.timeoutMs !== undefined) query.set('timeoutMs', String(opts.timeoutMs));
    if (opts.afterSeq !== undefined) query.set('afterSeq', String(opts.afterSeq));
    return this.request('GET', `/v1/agents/${agentId}/wait?${query.toString()}`);
  }

  /** Every agent, attention-sorted (herdr-agent-inbox idea). */
  inbox(): Promise<InboxItem[]> {
    return this.request('GET', '/v1/inbox');
  }

  setAttention(workspaceId: string, agentId: string, action: AttentionAction): Promise<InboxItem> {
    return this.request('POST', `/v1/agents/${agentId}/attention?workspaceId=${workspaceId}`, { action });
  }

  /** Send review comments back to the agent as a new R<n> task (herdr-reviewr idea). */
  reviewObjective(
    workspaceId: string,
    agentId: string,
    objectiveId: string,
    comments: ReviewComment[],
    start = true,
  ): Promise<{ taskId: string; title: string; started: boolean }> {
    return this.request(
      'POST',
      `/v1/objectives/${objectiveId}/review?workspaceId=${workspaceId}&agentId=${agentId}`,
      { comments, start },
    );
  }

  createObjective(input: {
    workspaceId: string;
    agentId: string;
    id: string;
    title: string;
    /** Omit (with `autoPlan: true`) to have the planner write the plan. */
    tasks?: Array<{ id: string; title: string }>;
    autoPlan?: boolean;
    budgetUsd?: number;
    budgetTokens?: number;
    definitionOfDone?: string;
    /** Repo binding id — the objective runs in its own worktree (P2.M9). */
    repo?: string;
    /** Verification commands overriding the repo binding's (P3.M3); `[]` disables. */
    verify?: string[];
  }): Promise<{ id: string }> {
    return this.request('POST', '/v1/objectives', input);
  }

  /** Router decisions + realized cost per task attempt (P3.M2). */
  objectiveRoutes(
    workspaceId: string,
    agentId: string,
    objectiveId: string,
  ): Promise<
    Array<{
      ts: string;
      taskId: string;
      decision: { taskClass: string; provider: string; model?: string; thinking?: string; reason: string };
      pricingSource: string;
      pricingStale: boolean;
      realized: { status: string; usd: number; tokens: { input: number; output: number }; derivedUsd?: number };
    }>
  > {
    return this.request('GET', `/v1/objectives/${objectiveId}/routes?workspaceId=${workspaceId}&agentId=${agentId}`);
  }

  /** Approve a planner-proposed plan and start the objective (P3.M1). */
  approvePlan(workspaceId: string, agentId: string, objectiveId: string): Promise<{ approved: boolean; tasks: PlanTaskView[] }> {
    return this.request(
      'POST',
      `/v1/objectives/${objectiveId}/plan/approve?workspaceId=${workspaceId}&agentId=${agentId}`,
      {},
    );
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
