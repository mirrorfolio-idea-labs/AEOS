import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { connectRunner } from '../src/protocol/client.js';
import { Runner } from '../src/runner/runner.js';

const SESSION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

function countingChild(lines: number, everyMs: number): string[] {
  return [
    process.execPath,
    '-e',
    `let i=0; const t=setInterval(()=>{console.log('line-'+(++i)); if(i>=${lines}) clearInterval(t);}, ${everyMs});`,
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(20);
  }
}

describe('Runner PTY (P2.M5.T1)', () => {
  let tmp: string;
  let runner: Runner | undefined;

  afterEach(async () => {
    await runner?.close();
    runner = undefined;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function makeRunner(childArgv: string[], extra: Partial<ConstructorParameters<typeof Runner>[0]> = {}): Runner {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-runner-pty-'));
    return new Runner({
      sessionId: SESSION_ID,
      sessionDir: path.join(tmp, 'session'),
      socketPath: path.join(tmp, 'runner.sock'),
      childArgv,
      heartbeatMs: 50,
      // NB: inside, so callers can't capture the pre-assignment `tmp`
      ptyCwd: tmp,
      ...extra,
    });
  }

  // PTY shells + parallel-suite load need more than vitest's 5s default
  it('bridges an interactive shell while the canonical event stream stays coherent', { timeout: 20_000 }, async () => {
    runner = makeRunner(countingChild(6, 120));
    await runner.start();

    const events: Array<{ seq: number; type: string }> = [];
    let ptyOut = '';
    let closed = false;
    const client = await connectRunner({
      socketPath: path.join(tmp, 'runner.sock'),
      sessionId: SESSION_ID,
      onEvent: (seq, event) => events.push({ seq, type: event.type }),
      onPtyMessage: (message) => {
        if (message.t === 'ptyOutput') ptyOut += message.data;
        if (message.t === 'ptyClosed') closed = true;
      },
    });

    await client.openPty(80, 24);
    client.sendPtyInput('echo aeos-pty-marker\r');

    await waitFor(() => ptyOut.includes('aeos-pty-marker'));

    // takeover must not disturb the main child's canonical stream
    await waitFor(() => events.filter((e) => e.type === 'item.message').length >= 4);
    const seqs = events.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1); // gap-free, ordered
    }

    client.releasePty();
    await waitFor(() => closed);
    client.close();
  });

  it('refuses a second concurrent PTY with a typed protocol error', { timeout: 20_000 }, async () => {
    runner = makeRunner([process.execPath, '-e', 'setInterval(()=>{},1000)']);
    await runner.start();

    let ptyOut = '';
    const client = await connectRunner({
      socketPath: path.join(tmp, 'runner.sock'),
      sessionId: SESSION_ID,
      onPtyMessage: (message) => {
        if (message.t === 'ptyOutput') ptyOut += message.data;
      },
    });
    await client.openPty(80, 24);
    // prove the takeover shell is actually alive before testing the guard —
    // a shell that died makes a fresh open legitimate, not an error
    client.sendPtyInput('echo alive-check\r');
    await waitFor(() => ptyOut.includes('alive-check'));

    let outcome = 'RESOLVED';
    try {
      await client.openPty(80, 24);
    } catch (error) {
      outcome = (error as Error).message;
    }
    expect(outcome).toMatch(/pty_already_active/);
    client.releasePty();
    await sleep(200);
    client.close();
  });

  it('logs PTY traffic as metadata only — never keystroke content', { timeout: 20_000 }, async () => {
    runner = makeRunner([process.execPath, '-e', 'setInterval(()=>{},1000)']);
    await runner.start();

    const client = await connectRunner({
      socketPath: path.join(tmp, 'runner.sock'),
      sessionId: SESSION_ID,
    });
    await client.openPty(80, 24);
    client.sendPtyInput('echo super-secret-keystrokes\r');
    await waitFor(() =>
      fs.existsSync(path.join(tmp, 'session', 'pty.log')) &&
      fs.readFileSync(path.join(tmp, 'session', 'pty.log'), 'utf8').split('\n').length >= 3,
    );
    const log = fs.readFileSync(path.join(tmp, 'session', 'pty.log'), 'utf8');
    expect(log).not.toContain('super-secret-keystrokes');
    for (const line of log.trimEnd().split('\n')) {
      const entry = JSON.parse(line) as { ts: string; dir: string; bytes?: number };
      expect(typeof entry.ts).toBe('string');
      expect(['open', 'close', 'in', 'out']).toContain(entry.dir);
      if (entry.dir === 'in' || entry.dir === 'out') expect(entry.bytes).toBeGreaterThan(0);
    }
    client.releasePty();
    await sleep(200);
    client.close();
  });
});
