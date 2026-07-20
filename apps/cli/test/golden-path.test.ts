import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CredentialProfileSchema } from '@aeos/contracts';
import { createEventBus } from '@aeos/kernel';
import { FakeAdapter, buildFixtureEvents } from '@aeos/provider-core';
import { createApiServer, listenApi } from '@aeos/api';
import { runCli } from '../src/cli.js';

let home: string;
let app: Awaited<ReturnType<typeof createApiServer>>;
let out: string[];
let err: string[];

const io = {
  out: (line: string) => out.push(line),
  err: (line: string) => err.push(line),
};

const run = (command: string) => runCli(command.split(/\s+/), io);

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'aeos-cli-'));
  app = await createApiServer({
    home,
    adapterFor: () =>
      new FakeAdapter({
        providerSessionId: 'ses_cli',
        events: buildFixtureEvents({ profileId: 'cp-default' }),
      }),
    credentialFor: () =>
      CredentialProfileSchema.parse({ id: 'cp-default', kind: 'api-key', secretRef: 'env' }),
    bus: createEventBus(),
  });
  const address = await listenApi(app, { port: 0 });
  process.env['AEOS_API_URL'] = address;
});

afterAll(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

describe('CLI golden path (T4 / M7 exit gate)', () => {
  it('create workspace → create agent → objective run → completed, then BYOK switch', async () => {
    out = [];
    err = [];
    expect(await run('health')).toBe(0);
    expect(out[0]).toContain('"status":"ok"');

    expect(await run('workspace create ws1 --name Workspace')).toBe(0);
    expect(
      await run('agent create dev --workspace ws1 --name Dev --credential-profile cp-default'),
    ).toBe(0);

    expect(
      await runCli(
        [
          'objective',
          'create',
          'obj1',
          '--workspace',
          'ws1',
          '--agent',
          'dev',
          '--title',
          'Golden path',
          '--task',
          'T1: first task',
          '--task',
          'T2: second task',
        ],
        io,
      ),
    ).toBe(0);

    expect(await run('objective run obj1 --workspace ws1 --agent dev --poll-ms 20')).toBe(0);
    expect(out.at(-1)).toBe('objective obj1 completed');

    expect(await run('objective status obj1 --workspace ws1 --agent dev')).toBe(0);
    const status = JSON.parse(out.at(-1) as string) as {
      tasks: Array<{ status: string }>;
      checkpoints: Array<{ status: string }>;
    };
    expect(status.tasks.map((t) => t.status)).toEqual(['completed', 'completed']);
    expect(status.checkpoints).toHaveLength(2);

    expect(await run('stop status')).toBe(0);
    expect(out.at(-1)).toBe('{"stopped":false}');
    expect(await run('stop --all')).toBe(0);
    expect(out.at(-1)).toContain('STOP engaged');
    expect(await run('resume-ops')).toBe(0);
    expect(out.at(-1)).toContain('STOP lifted');

    expect(await run('agent switch-credential dev --workspace ws1 --profile cp-acme')).toBe(0);
    expect(out.at(-1)).toContain('cp-acme');

    expect(err).toEqual([]);
  });

  it('unknown commands print usage and exit 1', async () => {
    out = [];
    err = [];
    expect(await run('frobnicate')).toBe(1);
    expect(err[0]).toContain('aeos —');
  });
});
