import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newEventId, PROTOCOL_VERSION } from '@aeos/contracts';
import { Runner } from '../src/runner/runner.js';
import { connectRunner } from '../src/protocol/client.js';
import { encodeFrame } from '../src/protocol/frames.js';
import { connectEndpoint, parseEndpoint, readPskFile, writePskFile, type RunnerEndpoint } from '../src/protocol/transport.js';

/**
 * P4.M4.T1: the framed runner protocol over TLS-PSK TCP — mutual auth
 * (a wrong key never completes a handshake), no key material in argv or
 * endpoint strings, and the runner survives hostile/garbage traffic.
 */
let tmp: string;
let runner: Runner;
let endpoint: RunnerEndpoint;
const sessionId = newEventId();

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-tcp-'));
  const pskFile = path.join(tmp, 'runner.psk');
  writePskFile(pskFile, randomBytes(32));
  runner = new Runner({
    sessionId,
    sessionDir: tmp,
    socketPath: path.join(tmp, 'unused.sock'),
    childArgv: [process.execPath, '-e', "let i=0; const t=setInterval(()=>{console.log('line-'+(++i)); if(i>=5) clearInterval(t);}, 20);"],
    heartbeatMs: 50,
    tcp: { host: '127.0.0.1', pskFile },
  });
  await runner.start();
  const published = fs.readFileSync(path.join(tmp, 'runner.endpoint'), 'utf8').trim();
  endpoint = parseEndpoint(published, { psk: readPskFile(pskFile), identity: sessionId });
});

afterEach(async () => {
  await runner.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('runner over TLS-PSK TCP (P4.M4.T1)', () => {
  it('publishes tcp://host:port (no key in it) and serves the protocol with replay', async () => {
    expect(fs.readFileSync(path.join(tmp, 'runner.endpoint'), 'utf8').trim()).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/);
    expect((fs.statSync(path.join(tmp, 'runner.psk')).mode & 0o777).toString(8)).toBe('600');
    await runner.waitForChildExit();
    const lines: string[] = [];
    const client = await connectRunner({
      endpoint,
      sessionId,
      onEvent: (_seq, e) => {
        if (e.type === 'item.message') lines.push((e.payload as { text: string }).text);
      },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(lines.filter((l) => l.startsWith('line-'))).toEqual(['line-1', 'line-2', 'line-3', 'line-4', 'line-5']);
    client.close();
  });

  it('mutual auth: a wrong key, a wrong identity or plain TCP never gets a session — and the runner survives', { timeout: 30_000 }, async () => {
    if (endpoint.kind !== 'tcp') throw new Error('expected tcp');
    await expect(connectRunner({ endpoint: { ...endpoint, psk: randomBytes(32) }, sessionId, connectTimeoutMs: 2000 })).rejects.toThrow();
    await expect(connectRunner({ endpoint: { ...endpoint, identity: 'someone-else' }, sessionId, connectTimeoutMs: 2000 })).rejects.toThrow();
    // a plain-TCP client speaking the protocol in clear text is refused at the TLS layer
    const plain = net.connect(endpoint.port, endpoint.host);
    await new Promise<void>((resolve) => {
      plain.on('connect', () => plain.write(encodeFrame({ t: 'hello', v: PROTOCOL_VERSION, minV: 1, maxV: 1, sessionId })));
      plain.resume(); // drain the server's TLS alert so 'end'/'close' can fire
      plain.on('close', () => resolve());
      plain.on('error', () => resolve());
    });
    // right key, wrong session id → rejected by the protocol handshake
    await expect(connectRunner({ endpoint, sessionId: newEventId(), connectTimeoutMs: 2000 })).rejects.toThrow(/wrong_session/);
    // and the legitimate daemon still connects
    const ok = await connectRunner({ endpoint, sessionId, connectTimeoutMs: 3000 });
    ok.close();
  });

  it('fuzz: random garbage and random frame chunking over the TLS stream never kill the runner', async () => {
    for (let round = 0; round < 20; round++) {
      const socket = connectEndpoint(endpoint);
      await new Promise<void>((resolve) => socket.once('ready', () => resolve()));
      const payload = Buffer.concat([
        encodeFrame({ t: 'hello', v: PROTOCOL_VERSION, minV: 1, maxV: 1, sessionId }),
        round % 2 === 0 ? randomBytes(1 + Math.floor(Math.random() * 512)) : encodeFrame({ t: 'nonsense', n: round }),
        encodeFrame({ t: 'replay', fromSeq: 0 }),
      ]);
      // random chunk boundaries on the way in
      let offset = 0;
      while (offset < payload.length) {
        const n = 1 + Math.floor(Math.random() * 64);
        socket.write(payload.subarray(offset, offset + n));
        offset += n;
      }
      await new Promise((r) => setTimeout(r, 10));
      socket.destroy();
    }
    const ok = await connectRunner({ endpoint, sessionId });
    expect(ok.helloAck.t).toBe('helloAck');
    ok.close();
  });
});
