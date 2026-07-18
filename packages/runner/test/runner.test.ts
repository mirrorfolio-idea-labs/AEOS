import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AeosEvent } from '@aeos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { connectRunner } from '../src/protocol/client.js';
import { Runner } from '../src/runner/runner.js';

const SESSION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Child that prints line-1..line-N on stdout, one every `everyMs`. */
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

interface Received {
  seq: number;
  event: AeosEvent;
}

describe('Runner process', () => {
  let tmp: string;
  let runner: Runner | undefined;

  afterEach(async () => {
    await runner?.close();
    runner = undefined;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function makeRunner(childArgv: string[], extra: Partial<ConstructorParameters<typeof Runner>[0]> = {}): Runner {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-runner-'));
    runner = new Runner({
      sessionId: SESSION_ID,
      sessionDir: path.join(tmp, 'session'),
      socketPath: path.join(tmp, 'runner.sock'),
      childArgv,
      heartbeatMs: 50,
      ...extra,
    });
    return runner;
  }

  it('survives daemon disconnect, keeps the child alive, and replays with no loss (accept)', async () => {
    const r = makeRunner(countingChild(30, 25));
    await r.start();
    const pidAtStart = r.childPid;
    expect(pidAtStart).toBeTypeOf('number');

    // first "daemon" connects from the beginning
    const first: Received[] = [];
    const clientA = await connectRunner({
      socketPath: path.join(tmp, 'runner.sock'),
      sessionId: SESSION_ID,
      fromSeq: 0,
      onEvent: (seq, event) => first.push({ seq, event }),
    });

    await waitFor(() => first.length >= 8);
    clientA.close(); // simulated daemon death mid-stream

    // child keeps producing while nobody is connected
    const seqAtDisconnect = first[first.length - 1]!.seq;
    await waitFor(() => r.lastSeq > seqAtDisconnect + 3);
    expect(r.childPid).toBe(pidAtStart); // child never restarted

    // second "daemon" reconnects with its lastSeq → replay fills the gap
    const second: Received[] = [];
    await connectRunner({
      socketPath: path.join(tmp, 'runner.sock'),
      sessionId: SESSION_ID,
      fromSeq: seqAtDisconnect,
      onEvent: (seq, event) => second.push({ seq, event }),
    });

    // child finishes: 30 lines + session.completed
    await waitFor(() => second.some(({ event }) => event.type === 'session.completed'));

    const combined = [...first, ...second];
    const seqs = combined.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length); // no duplicates across connections
    const lines = combined
      .filter(({ event }) => event.type === 'item.message')
      .map(({ event }) => (event.payload as { text: string }).text);
    expect(lines).toEqual(Array.from({ length: 30 }, (_, i) => `line-${i + 1}`)); // no loss, in order

    // runner-owned transcript has every line exactly once
    const transcript = fs
      .readFileSync(path.join(tmp, 'session', 'transcript.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as AeosEvent);
    const transcriptLines = transcript
      .filter((e) => e.type === 'item.message')
      .map((e) => (e.payload as { text: string }).text);
    expect(transcriptLines).toEqual(lines);
    expect(transcript.at(-1)?.type).toBe('session.completed');
  });

  it('hard timeout kills the child and emits session.failed', async () => {
    const r = makeRunner(
      [process.execPath, '-e', 'setInterval(() => {}, 1000);'],
      { hardTimeoutMs: 150 },
    );
    await r.start();
    const events: Received[] = [];
    await connectRunner({
      socketPath: path.join(tmp, 'runner.sock'),
      sessionId: SESSION_ID,
      onEvent: (seq, event) => events.push({ seq, event }),
    });
    await waitFor(() => events.some(({ event }) => event.type === 'session.failed'));
    const failure = events.find(({ event }) => event.type === 'session.failed')!;
    expect((failure.event.payload as { reason: string }).reason).toMatch(/hard timeout/);
    await waitFor(() => r.childPid === undefined || !isAlive(r.childPid));
  });

  it('a STOP file gracefully stops the child within one heartbeat (spec §17.5)', async () => {
    const stopFile = path.join(os.tmpdir(), `aeos-stop-${process.pid}-${Date.now()}`);
    const r = makeRunner(
      [process.execPath, '-e', 'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);'],
      { stopFilePaths: [stopFile] },
    );
    await r.start();
    try {
      fs.writeFileSync(stopFile, '');
      const code = await r.waitForChildExit();
      expect(code).toBe(0);
    } finally {
      fs.rmSync(stopFile, { force: true });
    }
  });

  it('rejects a client whose session id does not match', async () => {
    const r = makeRunner(countingChild(2, 20));
    await r.start();
    await expect(
      connectRunner({
        socketPath: path.join(tmp, 'runner.sock'),
        sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      }),
    ).rejects.toThrow(/wrong_session/);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
