import net from 'node:net';
import type { AeosEvent } from '@aeos/contracts';
import { PROTOCOL_VERSION } from '@aeos/contracts';
import { encodeFrame, FrameDecoder } from './frames.js';
import {
  parseWireMessage,
  SUPPORTED_VERSIONS,
  VersionMismatchError,
  type HelloAck,
} from './messages.js';

export interface RunnerClientOptions {
  socketPath: string;
  sessionId: string;
  /** Replay starts after this seq (0 = everything retained). */
  fromSeq?: number;
  onEvent?: (seq: number, event: AeosEvent) => void;
  onHeartbeat?: (seq: number | undefined) => void;
  onDisconnect?: () => void;
  connectTimeoutMs?: number;
}

export interface RunnerClient {
  /** The runner's handshake reply — carries its lastSeq at connect time. */
  helloAck: HelloAck;
  stop(reason: string): void;
  close(): void;
}

export class RunnerConnectError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'RunnerConnectError';
  }
}

/**
 * Daemon-side connection to a runner (the runner is the server — locked M3
 * topology). Resolves once hello/helloAck completes and replay has been
 * requested; events (replayed then live) arrive via `onEvent`.
 */
export function connectRunner(options: RunnerClientOptions): Promise<RunnerClient> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(options.socketPath);
    const decoder = new FrameDecoder();
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new RunnerConnectError(`timed out connecting to ${options.socketPath}`));
      }
    }, options.connectTimeoutMs ?? 5000);

    const fail = (error: unknown) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(
          error instanceof Error ? error : new RunnerConnectError(String(error), error),
        );
      }
    };

    socket.once('error', fail);
    socket.once('close', () => {
      if (settled) options.onDisconnect?.();
      else fail(new RunnerConnectError('socket closed during handshake'));
    });

    socket.once('connect', () => {
      socket.write(
        encodeFrame({
          t: 'hello',
          v: PROTOCOL_VERSION,
          minV: SUPPORTED_VERSIONS.minV,
          maxV: SUPPORTED_VERSIONS.maxV,
          sessionId: options.sessionId,
        }),
      );
    });

    socket.on('data', (chunk) => {
      let raws: unknown[];
      try {
        raws = decoder.push(chunk);
      } catch (error) {
        fail(error);
        return;
      }
      for (const raw of raws) {
        let message;
        try {
          message = parseWireMessage(raw);
        } catch (error) {
          fail(error);
          return;
        }
        if (!settled) {
          if (message.t === 'helloAck') {
            settled = true;
            clearTimeout(timeout);
            socket.write(encodeFrame({ t: 'replay', fromSeq: options.fromSeq ?? 0 }));
            resolve({
              helloAck: message,
              stop(reason: string) {
                socket.write(encodeFrame({ t: 'stop', reason }));
              },
              close() {
                socket.destroy();
              },
            });
          } else if (message.t === 'protoError') {
            fail(
              message.code === 'version_mismatch'
                ? new VersionMismatchError(SUPPORTED_VERSIONS, { minV: 0, maxV: 0 })
                : new RunnerConnectError(`${message.code}: ${message.message}`),
            );
          }
          continue;
        }
        if (message.t === 'event') options.onEvent?.(message.seq, message.event);
        else if (message.t === 'heartbeat') options.onHeartbeat?.(message.seq);
      }
    });
  });
}
