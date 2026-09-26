import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';

/**
 * Runner transports (spec §10/§16, P4.M4.T1). The framed protocol is
 * transport-agnostic; a runner listens on either
 *
 * - `unix` — a socket file under the session dir (the local default), or
 * - `tcp`  — TLS with a per-session pre-shared key (TLS-PSK), for runners
 *   on another host or pod. PSK gives MUTUAL authentication (both ends
 *   prove the key during the handshake; a wrong key never completes) and
 *   encryption, with no certificates to issue or rotate.
 *
 * The endpoint rides in the existing `SessionRecord.runnerSocket` string —
 * a path, or `tcp://host:port` — so contracts are unchanged. The key never
 * travels in argv or the session record: it lives in a 0600 file next to
 * the session (`runner.psk`).
 */

export type RunnerEndpoint =
  | { kind: 'unix'; path: string }
  | { kind: 'tcp'; host: string; port: number; psk: Buffer; identity: string };

/** TLS 1.2 PSK suites (AEAD only). TLS 1.3 external PSK is not exposed by node. */
export const PSK_CIPHERS = 'PSK-AES256-GCM-SHA384:PSK-CHACHA20-POLY1305:PSK-AES128-GCM-SHA256';

export const PSK_BYTES = 32;

export function formatEndpoint(endpoint: RunnerEndpoint): string {
  return endpoint.kind === 'unix' ? endpoint.path : `tcp://${endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host}:${String(endpoint.port)}`;
}

/** Parse a `runnerSocket` string; TCP endpoints need their key and identity. */
export function parseEndpoint(text: string, secret?: { psk: Buffer; identity: string }): RunnerEndpoint {
  const m = /^tcp:\/\/(?:\[([^\]]+)\]|([^:/]+)):(\d+)$/.exec(text);
  if (m === null) return { kind: 'unix', path: text };
  if (secret === undefined) throw new Error(`runner endpoint ${text} is TCP but no pre-shared key is available`);
  return { kind: 'tcp', host: (m[1] ?? m[2]) as string, port: Number(m[3]), psk: secret.psk, identity: secret.identity };
}

export function readPskFile(file: string): Buffer {
  const psk = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  if (psk.length < 16) throw new Error(`${file}: pre-shared key too short`);
  return psk;
}

export function writePskFile(file: string, psk: Buffer): void {
  fs.writeFileSync(file, `${psk.toString('hex')}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600); // an existing file keeps its mode on write
}

const tlsPskOptions = {
  ciphers: PSK_CIPHERS,
  minVersion: 'TLSv1.2' as const,
  maxVersion: 'TLSv1.2' as const,
};

/** Listen on an endpoint; for TCP the actual (possibly ephemeral) port is returned. */
export function listenEndpoint(
  endpoint: RunnerEndpoint,
  onConnection: (socket: net.Socket) => void,
): Promise<{ server: net.Server; endpoint: RunnerEndpoint }> {
  return new Promise((resolve, reject) => {
    if (endpoint.kind === 'unix') {
      const server = net.createServer(onConnection);
      server.once('error', reject);
      server.listen(endpoint.path, () => {
        server.removeListener('error', reject);
        resolve({ server, endpoint });
      });
      return;
    }
    const server = tls.createServer(
      {
        ...tlsPskOptions,
        pskCallback: (_socket, identity) => (identity === endpoint.identity ? endpoint.psk : null),
      },
      onConnection,
    );
    // a failed handshake (wrong key, plain TCP, scanner) must never crash the
    // runner — and handling the event means WE must drop the socket, or a
    // hostile client could hold connections open indefinitely
    server.on('tlsClientError', (_error, socket) => socket.destroy());
    server.once('error', reject);
    server.listen(endpoint.port, endpoint.host, () => {
      server.removeListener('error', reject);
      const address = server.address() as net.AddressInfo;
      resolve({ server, endpoint: { ...endpoint, port: address.port } });
    });
  });
}

/**
 * Connect to an endpoint. The returned socket emits `ready` once it can
 * carry frames (after the TLS handshake for TCP).
 */
export function connectEndpoint(endpoint: RunnerEndpoint): net.Socket {
  if (endpoint.kind === 'unix') {
    const socket = net.connect(endpoint.path);
    socket.once('connect', () => socket.emit('ready'));
    return socket;
  }
  const socket = tls.connect({
    ...tlsPskOptions,
    host: endpoint.host,
    port: endpoint.port,
    pskCallback: () => ({ psk: endpoint.psk, identity: endpoint.identity }),
    // PSK authenticates the peer; there is no certificate to check
    checkServerIdentity: () => undefined,
  });
  socket.once('secureConnect', () => socket.emit('ready'));
  return socket;
}
