import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AeosClient } from '@aeos/sdk';
import { DEFAULT_PINS, createBinaryManager, type ManagedHarness } from '@aeos/provider-core';

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

interface Parsed {
  positional: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        flags.set(key, [...(flags.get(key) ?? []), 'true']);
      } else {
        flags.set(key, [...(flags.get(key) ?? []), value]);
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const need = (parsed: Parsed, flag: string): string => {
  const value = parsed.flags.get(flag)?.[0];
  if (value === undefined) throw new Error(`missing required --${flag}`);
  return value;
};

const USAGE = `aeos — AEOS daemon CLI (set AEOS_API_URL, optional AEOS_API_TOKEN)

  aeos health
  aeos workspace create <id> --name <name>
  aeos agent create <id> --workspace <ws> --name <name> [--provider claude-code] [--credential-profile <cp>]
                   [--harness-version <pinned>] [--binary-path <byo executable>]
  aeos agent switch-credential <id> --workspace <ws> --profile <credentialProfileId>
  aeos objective create <id> --workspace <ws> --agent <agent> --title <title> --task "T1: first" [--task ...]
  aeos objective run <id> --workspace <ws> --agent <agent> [--poll-ms 250] [--timeout-ms 120000]
  aeos objective status <id> --workspace <ws> --agent <agent>
  aeos events tail [--type-prefix session.] [--agent <id>] [--max <n>]
  aeos stop --all          # kill switch: no new sessions spawn; in-flight ones finish
  aeos stop status
  aeos resume-ops          # lifts the kill switch
  aeos harness pins        # pinned harness releases of record
  aeos harness install <harness>@<version>   # fetch + integrity-check + seal (local, AEOS_HOME)
  aeos harness verify <harness>@<version>    # re-hash an install against its seal
  aeos harness list`;

const HARNESSES: readonly ManagedHarness[] = ['claude-code', 'codex', 'opencode'];

/** `codex@0.149.1` → harness + version (managed-binary commands are local, not API calls). */
function parseHarnessRef(ref: string | undefined): { harness: ManagedHarness; version: string } {
  const at = ref?.lastIndexOf('@') ?? -1;
  const harness = ref?.slice(0, at) as ManagedHarness;
  if (ref === undefined || at <= 0 || !HARNESSES.includes(harness)) {
    throw new Error(`expected <harness>@<version> with harness one of ${HARNESSES.join(', ')}`);
  }
  return { harness, version: ref.slice(at + 1) };
}

async function runHarnessCommand(action: string | undefined, ref: string | undefined, io: CliIo): Promise<number> {
  const home = process.env['AEOS_HOME'] ?? path.join(os.homedir(), '.aeos');
  const manager = createBinaryManager({ root: path.join(home, 'binaries') });
  if (action === 'pins') {
    for (const pin of DEFAULT_PINS) io.out(`${pin.harness}@${pin.version}  ${pin.package}  ${pin.integrity}`);
    return 0;
  }
  if (action === 'list') {
    for (const record of manager.list()) {
      io.out(`${record.harness}@${record.version}  sealed ${record.treeSha256.slice(0, 12)}  ${record.installedAt}`);
    }
    return 0;
  }
  if (action === 'install' || action === 'verify') {
    const { harness, version } = parseHarnessRef(ref);
    const binary =
      action === 'install'
        ? await manager.install(harness, version)
        : manager.verify(harness, version, { fresh: true });
    io.out(`${harness}@${version} ${action === 'install' ? 'installed' : 'verified'}: ${binary.executable}`);
    return 0;
  }
  io.err('usage: aeos harness pins|list|install <harness>@<version>|verify <harness>@<version>');
  return 1;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  const [group, action, id] = parsed.positional;
  const client = new AeosClient({
    baseUrl: process.env['AEOS_API_URL'] ?? 'http://127.0.0.1:7777',
    ...(process.env['AEOS_API_TOKEN'] === undefined
      ? {}
      : { token: process.env['AEOS_API_TOKEN'] }),
  });

  try {
    if (group === 'harness') return await runHarnessCommand(action, id, io);
    if (group === 'health') {
      io.out(JSON.stringify(await client.health()));
      return 0;
    }
    if (group === 'workspace' && action === 'create' && id !== undefined) {
      const workspace = await client.createWorkspace({ id, name: need(parsed, 'name') });
      io.out(`workspace ${workspace.id} created`);
      return 0;
    }
    if (group === 'agent' && action === 'create' && id !== undefined) {
      const agent = await client.createAgent({
        id,
        workspaceId: need(parsed, 'workspace'),
        name: need(parsed, 'name'),
        harness: {
          provider: (parsed.flags.get('provider')?.[0] ?? 'claude-code') as
            | 'claude-code'
            | 'codex'
            | 'opencode',
          ...(parsed.flags.get('harness-version')?.[0] === undefined
            ? {}
            : { version: parsed.flags.get('harness-version')?.[0] as string }),
          ...(parsed.flags.get('binary-path')?.[0] === undefined
            ? {}
            : { binaryPath: parsed.flags.get('binary-path')?.[0] as string }),
          featureToggles: {
            plugins: false,
            skills: false,
            mcpServers: false,
            userClaudeMd: false,
            autoMemory: false,
          },
        },
        credentialProfileId: parsed.flags.get('credential-profile')?.[0] ?? 'cp-default',
      });
      io.out(`agent ${agent.id} created in ${agent.workspaceId}`);
      return 0;
    }
    if (group === 'agent' && action === 'switch-credential' && id !== undefined) {
      const agent = await client.switchCredentialProfile(
        need(parsed, 'workspace'),
        id,
        need(parsed, 'profile'),
      );
      io.out(`agent ${agent.id} now uses credential profile ${agent.credentialProfileId}`);
      return 0;
    }
    if (group === 'objective' && action === 'create' && id !== undefined) {
      const tasks = (parsed.flags.get('task') ?? []).map((spec) => {
        const colon = spec.indexOf(':');
        if (colon === -1) throw new Error(`--task must look like "T1: title" (got "${spec}")`);
        return { id: spec.slice(0, colon).trim(), title: spec.slice(colon + 1).trim() };
      });
      await client.createObjective({
        workspaceId: need(parsed, 'workspace'),
        agentId: need(parsed, 'agent'),
        id,
        title: need(parsed, 'title'),
        tasks,
      });
      io.out(`objective ${id} created with ${tasks.length} tasks`);
      return 0;
    }
    if (group === 'objective' && (action === 'run' || action === 'status') && id !== undefined) {
      const workspaceId = need(parsed, 'workspace');
      const agentId = need(parsed, 'agent');
      if (action === 'status') {
        io.out(JSON.stringify(await client.objectiveStatus(workspaceId, agentId, id)));
        return 0;
      }
      await client.startObjective(workspaceId, agentId, id);
      const pollMs = Number(parsed.flags.get('poll-ms')?.[0] ?? 250);
      const timeoutMs = Number(parsed.flags.get('timeout-ms')?.[0] ?? 120_000);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const status = await client.objectiveStatus(workspaceId, agentId, id);
        const states = status.tasks.map((t) => t.status);
        io.out(`tasks: ${states.join(', ')}`);
        if (states.every((s) => s === 'completed')) {
          io.out(`objective ${id} completed`);
          return 0;
        }
        if (states.includes('blocked')) {
          io.err(`objective ${id} paused (blocked task)`);
          return 2;
        }
        if (Date.now() > deadline) {
          io.err(`objective ${id} timed out after ${timeoutMs}ms`);
          return 3;
        }
        await delay(pollMs);
      }
    }
    if (group === 'stop' && action === 'status') {
      io.out(JSON.stringify(await client.stopStatus()));
      return 0;
    }
    if (group === 'stop' && action === undefined) {
      if (parsed.flags.get('all') === undefined) {
        io.err('usage: aeos stop --all   (or: aeos stop status)');
        return 1;
      }
      const result = await client.stopAll();
      io.out(result.stopped ? 'STOP engaged — no new sessions will spawn' : 'not stopped');
      return 0;
    }
    if (group === 'resume-ops') {
      await client.resumeOps();
      io.out('STOP lifted — scheduling resumes');
      return 0;
    }
    if (group === 'events' && action === 'tail') {
      const max = Number(parsed.flags.get('max')?.[0] ?? Infinity);
      let count = 0;
      for await (const event of client.events({
        ...(parsed.flags.get('type-prefix')?.[0] === undefined
          ? {}
          : { typePrefix: parsed.flags.get('type-prefix')?.[0] as string }),
        ...(parsed.flags.get('agent')?.[0] === undefined
          ? {}
          : { agentId: parsed.flags.get('agent')?.[0] as string }),
      })) {
        io.out(`${event.ts} ${event.type} ${event.sessionId ?? ''}`.trim());
        if (++count >= max) return 0;
      }
      return 0;
    }
    io.err(USAGE);
    return 1;
  } catch (error: unknown) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
