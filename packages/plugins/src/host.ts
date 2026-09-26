import { fork, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AeosEventSchema, newEventId, type AeosEvent, type AgentConfig } from '@aeos/contracts';
import type { CapabilityMatrix, HarnessAdapter, HarnessProfile, SessionHandle, SpawnOptions } from '@aeos/provider-core';
import { PluginError, type PluginPackage } from './manifest.js';

function defaultChildPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sibling = path.join(here, 'host-child.js');
  // under vitest this module runs from src/ — the child always runs built
  return fs.existsSync(sibling) ? sibling : path.join(here, '..', 'dist', 'host-child.js');
}

export interface PluginHostOptions {
  childPath?: string;
  /** Crashes tolerated inside `crashWindowMs` before the plugin is disabled. */
  maxCrashes?: number;
  crashWindowMs?: number;
  /** Per-call timeout for describe/createProfile. */
  callTimeoutMs?: number;
  log?: (line: string) => void;
}

export type PluginHostState = 'stopped' | 'running' | 'crashed' | 'disabled';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/** Events flowing from the child into one proxied session. */
class StreamSink {
  private queue: AeosEvent[] = [];
  private waiters: Array<() => void> = [];
  done = false;
  push(event: AeosEvent): void {
    if (this.done) return;
    this.queue.push(event);
    this.wake();
  }
  end(): void {
    this.done = true;
    this.wake();
  }
  private wake(): void {
    for (const w of this.waiters.splice(0)) w();
  }
  async *iterate(): AsyncGenerator<AeosEvent> {
    for (;;) {
      const next = this.queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.done) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

interface ProxySession {
  sink: StreamSink;
  sessionId: string;
  source: string;
  handle: ProxyHandle;
  sawTerminal: boolean;
}

class ProxyHandle implements SessionHandle {
  readonly events: AsyncIterable<AeosEvent>;
  providerSessionId: string | undefined;
  resumeToken: string | undefined;
  costUsd: number | undefined;
  constructor(
    sink: StreamSink,
    private readonly onKill: () => void,
  ) {
    this.events = sink.iterate();
  }
  kill(): void {
    this.onKill();
  }
}

/** Deterministic ULIDs for pure `translate()` (same raw → same events). */
const goldenId = (n: number): string => n.toString(32).toUpperCase().replace(/[ILOU]/g, 'Z').padStart(26, '0');

/**
 * Runs one installed plugin in an isolated child process and exposes its
 * providers as ordinary HarnessAdapters (P4.M2.T2). A crash fails the
 * sessions in flight with `session.failed` and is contained: the next call
 * restarts the child; `maxCrashes` inside `crashWindowMs` disables it.
 */
export class PluginHost {
  private child: ChildProcess | undefined;
  private starting: Promise<Record<string, { capabilities: CapabilityMatrix }>> | undefined;
  private described: Record<string, { capabilities: CapabilityMatrix }> | undefined;
  private readonly pending = new Map<number, Pending>();
  private readonly streams = new Map<string, ProxySession>();
  private nextId = 1;
  private crashes: number[] = [];
  state: PluginHostState = 'stopped';
  lastError: string | undefined;

  constructor(
    readonly plugin: PluginPackage,
    private readonly opts: PluginHostOptions = {},
  ) {}

  /** Start the child (if needed) and return its providers' capabilities. */
  async start(): Promise<Record<string, { capabilities: CapabilityMatrix }>> {
    if (this.state === 'disabled') throw new PluginError('load_failed', `plugin ${this.plugin.name} is disabled after repeated crashes: ${this.lastError ?? ''}`, this.plugin.name);
    if (this.state === 'running' && this.described !== undefined) return this.described;
    this.starting ??= this.boot().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private boot(): Promise<Record<string, { capabilities: CapabilityMatrix }>> {
    const child = fork(this.opts.childPath ?? defaultChildPath(), [this.plugin.entry], {
      cwd: this.plugin.root,
      execArgv: [],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    this.child = child;
    return new Promise((resolve, reject) => {
      let ready = false;
      child.on('message', (raw) => {
        const msg = raw as { t: string; id?: number; result?: unknown; message?: string; stream?: string; event?: unknown; handle?: Record<string, unknown>; error?: string };
        if (msg.t === 'ready') {
          ready = true;
          this.state = 'running';
          this.call('describe', {})
            .then((d) => {
              this.described = d as Record<string, { capabilities: CapabilityMatrix }>;
              resolve(this.described);
            })
            .catch(reject);
        } else if (msg.t === 'fatal') {
          this.lastError = msg.message;
        } else if (msg.t === 'result' || msg.t === 'error') {
          const p = this.pending.get(msg.id as number);
          if (p === undefined) return;
          this.pending.delete(msg.id as number);
          clearTimeout(p.timer);
          if (msg.t === 'result') p.resolve(msg.result);
          else p.reject(new PluginError('load_failed', `${this.plugin.name}: ${msg.message ?? 'error'}`, this.plugin.name));
        } else if (msg.t === 'event' && msg.stream !== undefined) {
          this.onEvent(msg.stream, msg.event);
        } else if (msg.t === 'end' && msg.stream !== undefined) {
          const s = this.streams.get(msg.stream);
          if (s === undefined) return;
          if (msg.handle !== undefined) {
            const h = msg.handle;
            if (typeof h['providerSessionId'] === 'string') s.handle.providerSessionId = h['providerSessionId'];
            if (typeof h['resumeToken'] === 'string') s.handle.resumeToken = h['resumeToken'];
            if (typeof h['costUsd'] === 'number') s.handle.costUsd = h['costUsd'];
          }
          if (msg.error !== undefined && !s.sawTerminal) this.fail(s, `provider threw: ${msg.error}`);
          this.finish(msg.stream);
        }
      });
      child.on('exit', (code, signal) => {
        if (this.child === child) this.child = undefined;
        const reason = `plugin ${this.plugin.name} exited (${signal ?? `code ${String(code)}`})${this.lastError === undefined ? '' : `: ${this.lastError}`}`;
        this.onCrash(reason);
        if (!ready) reject(new PluginError('load_failed', reason, this.plugin.name));
      });
      child.on('error', (error) => {
        if (!ready) reject(new PluginError('load_failed', `${this.plugin.name}: ${error.message}`, this.plugin.name));
      });
    });
  }

  private onCrash(reason: string): void {
    if (this.state === 'stopped') return;
    this.lastError = reason;
    this.opts.log?.(`plugins: ${reason}`);
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new PluginError('load_failed', reason, this.plugin.name));
      this.pending.delete(id);
    }
    for (const [stream, s] of this.streams) {
      if (!s.sawTerminal) this.fail(s, reason);
      this.finish(stream);
    }
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < (this.opts.crashWindowMs ?? 60_000)), now];
    // capabilities are static: keep them, so adapters stay usable and the
    // next spawn/createProfile restarts the child on demand
    this.state = this.crashes.length >= (this.opts.maxCrashes ?? 3) ? 'disabled' : 'crashed';
  }

  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    if (child === undefined) return Promise.reject(new PluginError('load_failed', `plugin ${this.plugin.name} is not running`, this.plugin.name));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PluginError('load_failed', `${this.plugin.name}: ${method} timed out`, this.plugin.name));
      }, this.opts.callTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ t: 'call', id, method, ...params });
    });
  }

  private stamp(s: ProxySession, partial: unknown): AeosEvent | undefined {
    const p = (partial ?? {}) as { type?: unknown; payload?: unknown };
    const parsed = AeosEventSchema.safeParse({
      v: 1,
      id: newEventId(),
      ts: new Date().toISOString(),
      source: s.source,
      sessionId: s.sessionId,
      type: p.type,
      payload: p.payload ?? {},
    });
    return parsed.success ? parsed.data : undefined;
  }

  private onEvent(stream: string, partial: unknown): void {
    const s = this.streams.get(stream);
    if (s === undefined || s.sink.done) return;
    const event = this.stamp(s, partial);
    if (event === undefined) {
      // the host is authoritative: an off-contract event ends the session
      this.fail(s, `plugin emitted an event outside the AEOS contract: ${JSON.stringify(partial).slice(0, 200)}`);
      this.child?.send({ t: 'kill', stream });
      this.finish(stream);
      return;
    }
    if (event.type === 'session.completed' || event.type === 'session.failed') s.sawTerminal = true;
    s.sink.push(event);
  }

  private fail(s: ProxySession, reason: string): void {
    const event = this.stamp(s, { type: 'session.failed', payload: { reason } });
    if (event !== undefined) s.sink.push(event);
    s.sawTerminal = true;
  }

  private finish(stream: string): void {
    this.streams.get(stream)?.sink.end();
    this.streams.delete(stream);
  }

  /** A HarnessAdapter backed by one of this plugin's providers. */
  adapter(providerId: string): HarnessAdapter {
    const described = this.described?.[providerId];
    if (described === undefined) throw new PluginError('load_failed', `plugin ${this.plugin.name} has no running provider "${providerId}" (call start() first)`, this.plugin.name);
    const capabilities = described.capabilities;
    const source = `plugin:${providerId}`;
    return {
      id: source,
      capabilities: () => capabilities,
      createProfile: async (agent: AgentConfig): Promise<HarnessProfile> => {
        await this.start();
        return (await this.call('createProfile', { provider: providerId, agent })) as HarnessProfile;
      },
      spawn: (opts: SpawnOptions): SessionHandle => {
        const stream = `s${String(this.nextId++)}`;
        const sink = new StreamSink();
        let killed = false;
        const handle = new ProxyHandle(sink, () => {
          killed = true;
          this.child?.send({ t: 'kill', stream });
          this.finish(stream);
        });
        const session: ProxySession = { sink, sessionId: opts.sessionId, source, handle, sawTerminal: false };
        this.streams.set(stream, session);
        void this.start()
          .then(() => {
            if (killed) return undefined;
            return this.call('spawn', { provider: providerId, stream, opts: JSON.parse(JSON.stringify(opts)) as unknown });
          })
          .catch((error: unknown) => {
            if (!this.streams.has(stream)) return;
            this.fail(session, error instanceof Error ? error.message : String(error));
            this.finish(stream);
          });
        return handle;
      },
      translate: (raw: unknown): AeosEvent[] => {
        // translate() is pure and synchronous — run it in a throwaway child
        const result = spawnSync(process.execPath, [this.opts.childPath ?? defaultChildPath(), '--translate', this.plugin.entry, providerId], {
          input: JSON.stringify({ raw }), // an envelope, so `undefined` survives JSON
          encoding: 'utf8',
          timeout: 30_000,
        });
        if (result.status !== 0) throw new PluginError('load_failed', `${this.plugin.name}: translate failed: ${result.stderr.slice(-500)}`, this.plugin.name);
        const partials = JSON.parse(result.stdout || '[]') as Array<{ type: unknown; payload?: unknown }>;
        return partials.map((p, i) =>
          AeosEventSchema.parse({ v: 1, id: goldenId(i), ts: '1970-01-01T00:00:00.000Z', source, sessionId: 'translate', type: p.type, payload: p.payload ?? {} }),
        );
      },
    };
  }

  close(): void {
    this.state = 'stopped';
    for (const stream of [...this.streams.keys()]) this.finish(stream);
    this.child?.kill('SIGTERM');
    this.child = undefined;
  }
}
