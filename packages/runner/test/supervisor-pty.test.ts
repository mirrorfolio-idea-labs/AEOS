import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus, openIndexDb } from '@aeos/kernel';
import { createSupervisor, PtyAttachError } from '../src/index.js';

// vitest runs src/, where the default runner-main path doesn't resolve — pin it
const RUNNER_MAIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'runner',
  'main.js',
);

/**
 * P2.M5.T2 seam: the supervisor exposes a per-session PTY bridge that the
 * daemon hands to the API's websocket attach route.
 */
describe('supervisor PTY bridge (P2.M5.T2)', () => {
  let home: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supervisor: any;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-sup-pty-'));
    supervisor = createSupervisor({
      home,
      db: openIndexDb(home),
      bus: createEventBus(),
      runnerMainPath: RUNNER_MAIN,
      // detached runner boot can be slow under parallel-suite load
      connectTimeoutMs: 20_000,
    });
  });

  afterEach(() => {
    supervisor.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('refuses sessions without a live runner', async () => {
    await expect(supervisor.attachPty('nope', () => undefined)).rejects.toThrow(PtyAttachError);
  });

  it('pipes output up and forwards input, resize, and release down', async () => {
    const record = await supervisor.startSession({
      workspaceId: 'ws1',
      agentId: 'ada',
      childArgv: [
        process.execPath,
        '-e',
        `let i=0; const t=setInterval(()=>{console.log('line-'+(++i)); if(i>=3) clearInterval(t);}, 100);`,
      ],
    });

    let ptyOut = '';
    const handle = await supervisor.attachPty(record.id, (data: string) => {
      ptyOut += data;
    });
    handle.input('echo sup-pty-marker\r');
    const deadline = Date.now() + 15_000;
    while (!ptyOut.includes('sup-pty-marker')) {
      if (Date.now() > deadline) {
        throw new Error(`no echo; got ${JSON.stringify(ptyOut.slice(0, 200))}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    handle.resize(120, 30);
    handle.release();
    // after release a fresh shell may be opened again
    const again = await supervisor.attachPty(record.id, () => undefined);
    again.release();
  }, 20_000);
});
