import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { newEventId, PROTOCOL_VERSION, type AeosEvent } from '@aeos/contracts';
import { encodeFrame, FrameDecoder } from '../protocol/frames.js';
import {
  negotiateVersion,
  parseWireMessage,
  SUPPORTED_VERSIONS,
  type WireMessage,
} from '../protocol/messages.js';
import { RingBuffer } from './ring-buffer.js';

export interface RunnerOptions {
  sessionId: string;
  /** Session dir under AEOS_HOME — the runner owns transcript.ndjson here. */
  sessionDir: string;
  socketPath: string;
  /** argv[0] = command, rest = args. Arbitrary child in M3; harness in M4. */
  childArgv: string[];
  agentId?: string;
  heartbeatMs?: number;
  /** Kills the child and emits session.failed when exceeded. */
  hardTimeoutMs?: number;
  /** STOP files checked every heartbeat tick (spec §17.5). */
  stopFilePaths?: string[];
  ringCapacity?: number;
}

interface Connection {
  socket: net.Socket;
  /** true once hello/helloAck completed — only then may events flow. */
  handshaken: boolean;
  /** true once the client sent replay and caught up — live events flow. */
  live: boolean;
}

/**
 * One durable session runner (spec §10, Superset pattern): a separate OS
 * process that owns the harness child. It is the Unix-socket **server**; the
 * daemon connects as a client, so the runner survives any number of daemon
 * restarts. Events are buffered (ring), persisted locally
 * (`transcript.ndjson` — a daemon crash loses nothing), and streamed to
 * whoever is connected.
 */
export class Runner {
  private readonly opts: Required<Pick<RunnerOptions, 'heartbeatMs' | 'ringCapacity'>> &
    RunnerOptions;
  private readonly ring: RingBuffer<AeosEvent>;
  private readonly connections = new Set<Connection>();
  private child: ChildProcess | undefined;
  private server: net.Server | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private hardTimeoutTimer: NodeJS.Timeout | undefined;
  private stopRequested = false;
  private exitPromise: Promise<number | null> | undefined;

  constructor(options: RunnerOptions) {
    this.opts = { heartbeatMs: 2000, ringCapacity: 1024, ...options };
    this.ring = new RingBuffer<AeosEvent>(this.opts.ringCapacity);
  }

  get childPid(): number | undefined {
    return this.child?.pid;
  }

  get lastSeq(): number {
    return this.ring.lastSeq;
  }

  async start(): Promise<void> {
    fs.mkdirSync(this.opts.sessionDir, { recursive: true });
    fs.rmSync(this.opts.socketPath, { force: true });
    fs.mkdirSync(path.dirname(this.opts.socketPath), { recursive: true });

    this.spawnChild();
    await this.listen();

    this.heartbeatTimer = setInterval(() => this.onHeartbeatTick(), this.opts.heartbeatMs);
    if (this.opts.hardTimeoutMs !== undefined) {
      this.hardTimeoutTimer = setTimeout(() => {
        this.record(this.makeEvent('session.failed', { reason: 'hard timeout exceeded' }));
        this.child?.kill('SIGKILL');
      }, this.opts.hardTimeoutMs);
    }
  }

  /** Resolves with the child's exit code once it terminates. */
  waitForChildExit(): Promise<number | null> {
    if (this.exitPromise === undefined) throw new Error('runner not started');
    return this.exitPromise;
  }

  /** Graceful shutdown: stop child (if alive), close socket + timers. */
  async close(): Promise<void> {
    this.requestChildStop('runner closing');
    if (this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null) {
      await this.exitPromise; // `killed` only means the signal was sent — wait for the real exit
    }
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    if (this.hardTimeoutTimer !== undefined) clearTimeout(this.hardTimeoutTimer);
    for (const conn of this.connections) conn.socket.destroy();
    this.connections.clear();
    await new Promise<void>((resolve) => {
      if (this.server === undefined) return resolve();
      this.server.close(() => resolve());
    });
    fs.rmSync(this.opts.socketPath, { force: true });
  }

  // ── child ──────────────────────────────────────────────────────────────

  private spawnChild(): void {
    const [command, ...args] = this.opts.childArgv;
    if (command === undefined) throw new Error('childArgv must contain a command');
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;

    const wrap = (stream: NodeJS.ReadableStream, role: 'assistant' | 'system') => {
      readline.createInterface({ input: stream }).on('line', (line) => {
        this.record(this.makeEvent('item.message', { role, text: line }));
      });
    };
    if (child.stdout) wrap(child.stdout, 'assistant');
    if (child.stderr) wrap(child.stderr, 'system');

    this.exitPromise = new Promise((resolve) => {
      child.once('exit', (code) => {
        if (this.hardTimeoutTimer !== undefined) clearTimeout(this.hardTimeoutTimer);
        if (code === 0) {
          this.record(this.makeEvent('session.completed', {}));
        } else if (!this.hasFailureEvent()) {
          this.record(
            this.makeEvent('session.failed', { reason: `child exited with code ${String(code)}` }),
          );
        }
        resolve(code);
      });
    });
  }

  private hasFailureEvent(): boolean {
    return this.ring.since(0).some((e) => e.item.type === 'session.failed');
  }

  private requestChildStop(reason: string): void {
    if (this.stopRequested) return;
    this.stopRequested = true;
    if (this.child !== undefined && this.child.exitCode === null) {
      this.record(this.makeEvent('item.message', { role: 'system', text: `stop: ${reason}` }));
      this.child.kill('SIGTERM');
    }
  }

  // ── events ─────────────────────────────────────────────────────────────

  private makeEvent<T extends AeosEvent['type']>(
    type: T,
    payload: Extract<AeosEvent, { type: T }>['payload'],
  ): AeosEvent {
    const base = {
      v: PROTOCOL_VERSION,
      id: newEventId(),
      ts: new Date().toISOString(),
      source: 'runner',
      sessionId: this.opts.sessionId,
      ...(this.opts.agentId !== undefined ? { agentId: this.opts.agentId } : {}),
    };
    return { ...base, type, payload } as AeosEvent;
  }

  /** Buffer → persist locally → stream. Publish order is transcript order. */
  private record(event: AeosEvent): void {
    const seq = this.ring.append(event);
    fs.mkdirSync(this.opts.sessionDir, { recursive: true });
    fs.appendFileSync(
      path.join(this.opts.sessionDir, 'transcript.ndjson'),
      `${JSON.stringify(event)}\n`,
    );
    this.broadcast({ t: 'event', seq, event });
  }

  private broadcast(message: WireMessage): void {
    for (const conn of this.connections) {
      if (conn.handshaken && (message.t !== 'event' || conn.live)) {
        conn.socket.write(encodeFrame(message));
      }
    }
  }

  private onHeartbeatTick(): void {
    this.broadcast({ t: 'heartbeat', seq: this.ring.lastSeq });
    const stopFiles = this.opts.stopFilePaths ?? [];
    if (stopFiles.some((p) => fs.existsSync(p))) {
      this.requestChildStop('STOP file present');
    }
  }

  // ── socket server ──────────────────────────────────────────────────────

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.onConnection(socket));
      this.server = server;
      server.once('error', reject);
      server.listen(this.opts.socketPath, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  }

  private onConnection(socket: net.Socket): void {
    const conn: Connection = { socket, handshaken: false, live: false };
    this.connections.add(conn);
    const decoder = new FrameDecoder();

    socket.on('data', (chunk) => {
      let messages: unknown[];
      try {
        messages = decoder.push(chunk);
      } catch (error) {
        this.sendError(socket, 'bad_frame', error);
        return;
      }
      for (const raw of messages) {
        try {
          this.onMessage(conn, parseWireMessage(raw));
        } catch (error) {
          this.sendError(socket, 'bad_message', error);
          return;
        }
      }
    });
    const drop = () => this.connections.delete(conn);
    socket.on('close', drop);
    socket.on('error', drop); // client vanished — the runner never dies with it
  }

  private onMessage(conn: Connection, message: WireMessage): void {
    switch (message.t) {
      case 'hello': {
        if (message.sessionId !== this.opts.sessionId) {
          this.sendError(conn.socket, 'wrong_session', new Error(`session ${message.sessionId}`));
          return;
        }
        let v: number;
        try {
          v = negotiateVersion(SUPPORTED_VERSIONS, { minV: message.minV, maxV: message.maxV });
        } catch (error) {
          this.sendError(conn.socket, 'version_mismatch', error);
          return;
        }
        conn.handshaken = true;
        conn.socket.write(encodeFrame({ t: 'helloAck', v, lastSeq: this.ring.lastSeq }));
        return;
      }
      case 'replay': {
        if (!conn.handshaken) return;
        for (const entry of this.ring.since(message.fromSeq)) {
          conn.socket.write(encodeFrame({ t: 'event', seq: entry.seq, event: entry.item }));
        }
        conn.live = true;
        return;
      }
      case 'stop':
        this.requestChildStop(message.reason);
        return;
      case 'heartbeat':
        return; // client liveness pings need no reply
      default:
        this.sendError(conn.socket, 'unexpected_message', new Error(message.t));
    }
  }

  private sendError(socket: net.Socket, code: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    socket.write(encodeFrame({ t: 'protoError', code, message }));
    socket.end();
  }
}
