import fs from 'node:fs';
import path from 'node:path';
import {
  AeosEventSchema,
  newEventId,
  type AeosEvent,
  type AgentStatus,
} from '@aeos/contracts';
import { agentDir, writeFileAtomic, type EventBus } from '@aeos/kernel';

export interface AgentRef {
  workspaceId: string;
  id: string;
}

export interface AgentStatusEntry {
  workspaceId: string;
  agentId: string;
  status: AgentStatus;
  /** Monotonic per agent, persisted — inbox "unseen" and wait both key off it. */
  seq: number;
  since: string;
  via: 'events' | 'screen';
  reason?: string;
  rule?: string;
  sessionId?: string;
}

export interface StatusUpdate {
  via: 'events' | 'screen';
  reason?: string | undefined;
  rule?: string | undefined;
  sessionId?: string | undefined;
}

export interface WaitOptions {
  until: readonly AgentStatus[];
  timeoutMs: number;
  /**
   * Only a transition AFTER this seq satisfies the wait (race-free "prompt
   * then wait": read seq, act, wait from it). Omit to also accept the
   * current status when it already matches — herdr's `agent wait` rule.
   */
  afterSeq?: number;
  signal?: AbortSignal;
}

const statusFile = (home: string, ref: AgentRef): string =>
  path.join(agentDir(home, ref.workspaceId, ref.id), 'status.json');

/**
 * Per-agent attention status (P2.M10.T1, idea from herdr's agent-state
 * detection): derived from the canonical event stream of each run and, for
 * interactive PTY takeovers, from screen rules. Files are truth — the entry
 * persists to `<agent>/status.json` so `seq` stays monotonic across daemon
 * restarts (a `working` entry found at boot is stale and reads as `idle`).
 */
export class AgentStatusTracker {
  private readonly entries = new Map<string, AgentStatusEntry>();
  private readonly listeners = new Set<(entry: AgentStatusEntry) => void>();

  constructor(
    private readonly home: string,
    private bus?: EventBus,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Late-bind the bus (a tracker first built without one starts publishing). */
  attachBus(bus: EventBus): void {
    this.bus ??= bus;
  }

  private key(ref: AgentRef): string {
    return `${ref.workspaceId}/${ref.id}`;
  }

  get(ref: AgentRef): AgentStatusEntry {
    const cached = this.entries.get(this.key(ref));
    if (cached !== undefined) return cached;
    let entry: AgentStatusEntry = {
      workspaceId: ref.workspaceId,
      agentId: ref.id,
      status: 'idle',
      seq: 0,
      since: this.now(),
      via: 'events',
    };
    try {
      const stored = JSON.parse(fs.readFileSync(statusFile(this.home, ref), 'utf8')) as AgentStatusEntry;
      entry =
        stored.status === 'working'
          ? { ...stored, status: 'idle', reason: 'daemon restarted mid-session' }
          : stored;
    } catch {
      // no status yet — idle
    }
    this.entries.set(this.key(ref), entry);
    return entry;
  }

  /** Record a status; emits `agent.status_changed` only on an actual change. */
  set(ref: AgentRef, status: AgentStatus, update: StatusUpdate): AgentStatusEntry {
    const previous = this.get(ref);
    // same status is a no-op — except a NEW reason to be blocked (another
    // approval, a budget stop after a prompt), which deserves fresh attention
    if (previous.status === status && (status !== 'blocked' || previous.reason === update.reason)) return previous;
    const entry: AgentStatusEntry = {
      workspaceId: ref.workspaceId,
      agentId: ref.id,
      status,
      seq: previous.seq + 1,
      since: this.now(),
      via: update.via,
      ...(update.reason === undefined ? {} : { reason: update.reason }),
      ...(update.rule === undefined ? {} : { rule: update.rule }),
      ...(update.sessionId === undefined ? {} : { sessionId: update.sessionId }),
    };
    this.entries.set(this.key(ref), entry);
    try {
      fs.mkdirSync(path.dirname(statusFile(this.home, ref)), { recursive: true });
      writeFileAtomic(statusFile(this.home, ref), JSON.stringify(entry, null, 2) + '\n');
    } catch {
      // agent dir gone (deleted agent) — in-memory status still serves waits
    }
    this.bus?.publish(
      AeosEventSchema.parse({
        v: 1,
        id: newEventId(),
        ts: entry.since,
        source: 'daemon',
        agentId: ref.id,
        ...(entry.sessionId === undefined ? {} : { sessionId: entry.sessionId }),
        type: 'agent.status_changed',
        payload: {
          workspaceId: ref.workspaceId,
          status,
          previous: previous.status,
          seq: entry.seq,
          via: update.via,
          ...(update.reason === undefined ? {} : { reason: update.reason }),
          ...(update.rule === undefined ? {} : { rule: update.rule }),
        },
      }),
    );
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  /**
   * Fold one canonical event of a run into the agent's status. Blocked
   * wins until the block is resolved. Session ends do NOT mean `done` — a
   * run spans many task sessions, so the objective outcome (set by the run
   * owner) decides `done`/`blocked`; this keeps notifications to one per run.
   */
  observe(ref: AgentRef, event: AeosEvent): void {
    const sessionId = event.sessionId;
    const at = (status: AgentStatus, reason?: string): void => {
      this.set(ref, status, { via: 'events', reason, sessionId });
    };
    switch (event.type) {
      case 'approval.request':
        at('blocked', `approval requested: ${event.payload.action}`);
        return;
      case 'budget.exceeded':
        at('blocked', `budget ${event.payload.kind} cap reached`);
        return;
      case 'approval.resolved':
        at('working');
        return;
      case 'session.created':
      case 'turn.started':
      case 'item.message':
      case 'item.tool_call':
      case 'item.tool_result':
      case 'item.file_change':
        if (this.get(ref).status !== 'blocked' || event.type === 'session.created') at('working');
        return;
      default:
        return;
    }
  }

  list(): AgentStatusEntry[] {
    return [...this.entries.values()];
  }

  /** Resolves with the matching entry, or `undefined` on timeout/abort. */
  waitFor(ref: AgentRef, opts: WaitOptions): Promise<AgentStatusEntry | undefined> {
    const matches = (entry: AgentStatusEntry): boolean =>
      opts.until.includes(entry.status) && (opts.afterSeq === undefined || entry.seq > opts.afterSeq);
    const current = this.get(ref);
    if (matches(current)) return Promise.resolve(current);
    return new Promise((resolve) => {
      const done = (entry: AgentStatusEntry | undefined): void => {
        clearTimeout(timer);
        this.listeners.delete(listener);
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(entry);
      };
      const listener = (entry: AgentStatusEntry): void => {
        if (entry.workspaceId === ref.workspaceId && entry.agentId === ref.id && matches(entry)) done(entry);
      };
      const onAbort = (): void => done(undefined);
      const timer = setTimeout(() => done(undefined), opts.timeoutMs);
      this.listeners.add(listener);
      opts.signal?.addEventListener('abort', onAbort);
    });
  }

  /** Subscribe to every status change (notifications, UI); returns unsubscribe. */
  onChange(listener: (entry: AgentStatusEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const trackers = new Map<string, AgentStatusTracker>();

/**
 * One tracker per AEOS home: the API server and the daemon's resume-on-boot
 * path build separate contexts over the same home and bus, and must share
 * status (and its seq) to keep waits and the inbox coherent.
 */
export function statusTrackerFor(home: string, bus?: EventBus): AgentStatusTracker {
  let tracker = trackers.get(home);
  if (tracker === undefined) {
    tracker = new AgentStatusTracker(home, bus);
    trackers.set(home, tracker);
  } else if (bus !== undefined) {
    tracker.attachBus(bus);
  }
  return tracker;
}
