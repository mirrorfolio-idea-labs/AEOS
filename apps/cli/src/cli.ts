import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AeosClient } from '@aeos/sdk';
import { spawnSync } from 'node:child_process';
import type { ProviderId } from '@aeos/contracts';
import { DEFAULT_PINS, createBinaryManager, dockerAvailable, type ManagedHarness } from '@aeos/provider-core';
import { RUNNER_DOCKERFILE } from './runner-dockerfile.js';
import { applyPlan, currentPlatform, currentUser, planInstall, planUninstall, resolveAeosd } from './service.js';
import { PluginError, installPlugin, listInstalledPlugins, removePlugin } from '@aeos/plugins';

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
  aeos agent create <id> --workspace <ws> --name <name> [--provider claude-code|codex|opencode|plugin:<id>] [--credential-profile <cp>]
                   [--harness-version <pinned>] [--binary-path <byo executable>]
  aeos agent switch-credential <id> --workspace <ws> --profile <credentialProfileId>
  aeos agent status <id> --workspace <ws>
  aeos agent wait <id> --workspace <ws> [--until blocked,done] [--timeout-ms 30000] [--after-seq <n>]
  aeos agent seen|unread|settle|unsettle <id> --workspace <ws>
  aeos inbox               # every agent, attention-sorted (blocked first)
  aeos memory proposals --workspace <ws> --agent <agent>        # queued lessons/preferences
  aeos memory accept [<id>] --workspace <ws> --agent <agent>    # all, or one
  aeos memory reject <id> --workspace <ws> --agent <agent>
  aeos job add <id> --cron "0 3 * * *" --workspace <ws> --agent <agent> --objective <obj>   # UTC
  aeos job add <id> --idle-ms 600000 [--min-interval-ms 3600000] --curator
  aeos job list | aeos job rm <id>
  aeos repo bind <id> --workspace <ws> --agent <agent> --path </abs/checkout> [--base-ref main] [--verify "pnpm test" ...]
  aeos repo unbind <id> --workspace <ws> --agent <agent>
  aeos objective create <id> --workspace <ws> --agent <agent> --title <title> --task "T1: first" [--task ...]
                        [--repo <binding>] [--done "definition of done"] [--verify "cmd" ...]
  aeos objective create <id> --workspace <ws> --agent <agent> --title <title> --auto-plan   # planner writes the plan
  aeos objective approve-plan <id> --workspace <ws> --agent <agent>
  aeos objective routes <id> --workspace <ws> --agent <agent>   # router decisions + realized cost
  aeos objective diff <id> --workspace <ws> --agent <agent> [--scope branch|uncommitted|last-commit]
  aeos objective review <id> --workspace <ws> --agent <agent> --comment "src/a.ts:12: rename this" [--comment ...]
  aeos objective run <id> --workspace <ws> --agent <agent> [--poll-ms 250] [--timeout-ms 120000]
  aeos objective status <id> --workspace <ws> --agent <agent>
  aeos events tail [--type-prefix session.] [--agent <id>] [--max <n>]
  aeos stop --all          # kill switch: no new sessions spawn; in-flight ones finish
  aeos stop status
  aeos resume-ops          # lifts the kill switch
  aeos harness pins        # pinned harness releases of record
  aeos service install [--aeosd <main.js>] [--port 7777] [--host 0.0.0.0 --token-file <f>] [--dry-run]
                       # run aeosd as a user service (systemd user unit / launchd agent)
  aeos service uninstall | aeos service status
  aeos plugin install <npm-spec|./plugin.tgz>   # third-party plugin (no install scripts run; restart aeosd to load)
  aeos plugin list | aeos plugin remove <package>
  aeos sandbox build [--tag aeos-runner:local]   # container-tier runtime image (P4.M1)
  aeos sandbox status
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
    if (group === 'sandbox') return runSandboxCommand(action, parsed, io);
    if (group === 'plugin') return runPluginCommand(action, id, io);
    if (group === 'service') return runServiceCommand(action, parsed, io);
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
          // a builtin or `plugin:<id>` — the daemon validates it (P4.M2)
          provider: (parsed.flags.get('provider')?.[0] ?? 'claude-code') as ProviderId,
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
    if (group === 'agent' && action === 'status' && id !== undefined) {
      const entry = await client.agentStatus(need(parsed, 'workspace'), id);
      io.out(`${entry.agentId} ${entry.status} (seq ${String(entry.seq)}, via ${entry.via})${entry.reason === undefined ? '' : ` — ${entry.reason}`}`);
      return 0;
    }
    if (group === 'agent' && action === 'wait' && id !== undefined) {
      const until = (parsed.flags.get('until')?.[0] ?? 'blocked,done').split(',') as Array<
        'idle' | 'working' | 'blocked' | 'done' | 'unknown'
      >;
      const afterSeq = parsed.flags.get('after-seq')?.[0];
      const result = await client.waitForAgent(need(parsed, 'workspace'), id, {
        until,
        timeoutMs: Number(parsed.flags.get('timeout-ms')?.[0] ?? 30_000),
        ...(afterSeq === undefined ? {} : { afterSeq: Number(afterSeq) }),
      });
      io.out(`${result.entry.agentId} ${result.entry.status}${result.entry.reason === undefined ? '' : ` — ${result.entry.reason}`}`);
      if (!result.matched) {
        io.err(`timed out waiting for ${until.join('|')}`);
        return 4;
      }
      return 0;
    }
    if (
      group === 'agent' &&
      (action === 'seen' || action === 'unread' || action === 'settle' || action === 'unsettle') &&
      id !== undefined
    ) {
      const item = await client.setAttention(need(parsed, 'workspace'), id, action);
      io.out(`${item.agentId}: ${item.settled ? 'settled' : item.unseen ? 'unseen' : 'seen'}`);
      return 0;
    }
    if (group === 'memory' && (action === 'proposals' || action === 'accept' || action === 'reject')) {
      const workspaceId = need(parsed, 'workspace');
      const agentId = need(parsed, 'agent');
      if (action === 'proposals') {
        for (const p of await client.memoryProposals(workspaceId, agentId)) {
          io.out(`${p.id}  ${p.op} ${p.path}${p.hook === undefined ? '' : `  — ${p.hook}`}`);
        }
        return 0;
      }
      if (action === 'reject') {
        if (id === undefined) throw new Error('usage: aeos memory reject <id> …');
        await client.rejectMemoryProposal(workspaceId, agentId, id);
        io.out(`rejected ${id}`);
        return 0;
      }
      for (const r of await client.applyMemoryProposals(workspaceId, agentId, id === undefined ? undefined : [id])) {
        io.out(`${r.id}: ${r.status}${r.error === undefined ? '' : ` (${r.error})`}`);
      }
      return 0;
    }
    if (group === 'job' && action === 'list') {
      for (const job of await client.listJobs()) {
        const when = job.kind === 'cron' ? `cron "${job.cron ?? ''}"` : `idle ${String(job.idleMs)}ms`;
        const what = job.action.type === 'curator' ? 'curator' : `start ${job.action.workspaceId}/${job.action.agentId}/${job.action.objectiveId}`;
        io.out(
          `${job.id}  ${when}  → ${what}${job.enabled ? '' : ' (disabled)'}  last=${job.lastRunAt ?? 'never'}${job.lastError === undefined ? '' : `  error: ${job.lastError}`}`,
        );
      }
      return 0;
    }
    if (group === 'job' && action === 'rm' && id !== undefined) {
      await client.deleteJob(id);
      io.out(`job ${id} deleted`);
      return 0;
    }
    if (group === 'job' && action === 'add' && id !== undefined) {
      const cron = parsed.flags.get('cron')?.[0];
      const idleMs = parsed.flags.get('idle-ms')?.[0];
      if ((cron === undefined) === (idleMs === undefined)) throw new Error('aeos job add needs exactly one of --cron or --idle-ms');
      const minInterval = parsed.flags.get('min-interval-ms')?.[0];
      const job = await client.saveJob({
        id,
        ...(cron === undefined ? { kind: 'idle' as const, idleMs: Number(idleMs) } : { kind: 'cron' as const, cron }),
        ...(minInterval === undefined ? {} : { minIntervalMs: Number(minInterval) }),
        action:
          parsed.flags.has('curator')
            ? { type: 'curator' }
            : {
                type: 'start-objective',
                workspaceId: need(parsed, 'workspace'),
                agentId: need(parsed, 'agent'),
                objectiveId: need(parsed, 'objective'),
              },
      });
      io.out(`job ${job.id} saved (${job.kind})`);
      return 0;
    }
    if (group === 'inbox') {
      const marks = ['!', '*', '~', ' ', '-'];
      for (const item of await client.inbox()) {
        io.out(
          `${marks[item.bucket] ?? ' '} ${item.workspaceId}/${item.agentId}  ${item.status}${item.unseen ? ' (new)' : ''}${item.reason === undefined ? '' : `  ${item.reason}`}`,
        );
      }
      return 0;
    }
    if (group === 'repo' && (action === 'bind' || action === 'unbind') && id !== undefined) {
      const workspaceId = need(parsed, 'workspace');
      const agentId = need(parsed, 'agent');
      if (action === 'unbind') {
        await client.unbindRepo(workspaceId, agentId, id);
        io.out(`repo ${id} unbound from ${agentId}`);
        return 0;
      }
      const baseRef = parsed.flags.get('base-ref')?.[0];
      await client.bindRepo(workspaceId, agentId, {
        id,
        path: path.resolve(need(parsed, 'path')),
        ...(baseRef === undefined ? {} : { baseRef }),
        ...(parsed.flags.get('verify') === undefined ? {} : { verify: parsed.flags.get('verify') as string[] }),
      });
      io.out(`repo ${id} bound to ${agentId} — objectives with --repo ${id} run in their own worktree`);
      return 0;
    }
    if (group === 'objective' && action === 'diff' && id !== undefined) {
      const scope = (parsed.flags.get('scope')?.[0] ?? 'branch') as 'branch' | 'uncommitted' | 'last-commit';
      const result = await client.objectiveDiff(need(parsed, 'workspace'), need(parsed, 'agent'), id, scope);
      io.out(`# ${result.branch} (${result.scope}) — ${result.worktree}`);
      io.out(result.diff.length > 0 ? result.diff.trimEnd() : '(no changes)');
      return 0;
    }
    if (group === 'objective' && action === 'review' && id !== undefined) {
      const comments = (parsed.flags.get('comment') ?? []).map((spec) => {
        // "path:line: body" | "path: body" | "body"
        const located = /^([^\s:]+):(\d+):\s*(.+)$/s.exec(spec);
        if (located) return { file: located[1] as string, line: Number(located[2]), body: located[3] as string };
        const filed = /^([^\s:]+\.[A-Za-z0-9]+):\s*(.+)$/s.exec(spec);
        if (filed) return { file: filed[1] as string, body: filed[2] as string };
        return { body: spec };
      });
      if (comments.length === 0) throw new Error('at least one --comment is required');
      const result = await client.reviewObjective(need(parsed, 'workspace'), need(parsed, 'agent'), id, comments);
      io.out(`review sent as task ${result.taskId}: ${result.title}${result.started ? ' — objective restarted' : ''}`);
      return 0;
    }
    if (group === 'objective' && action === 'routes' && id !== undefined) {
      for (const r of await client.objectiveRoutes(need(parsed, 'workspace'), need(parsed, 'agent'), id)) {
        const usd = r.realized.derivedUsd ?? r.realized.usd;
        io.out(
          `${r.taskId} [${r.decision.taskClass}] ${r.decision.provider}/${r.decision.model ?? 'default'}  ${r.realized.status}  $${usd.toFixed(4)}${r.realized.derivedUsd === undefined ? '' : ' (token-priced)'}`,
        );
      }
      return 0;
    }
    if (group === 'objective' && action === 'approve-plan' && id !== undefined) {
      const result = await client.approvePlan(need(parsed, 'workspace'), need(parsed, 'agent'), id);
      for (const task of result.tasks) io.out(`  ${task.id} [${task.taskClass ?? 'implement'}] ${task.title}`);
      io.out(`plan approved — objective ${id} started`);
      return 0;
    }
    if (group === 'objective' && action === 'create' && id !== undefined) {
      const autoPlan = parsed.flags.get('auto-plan') !== undefined;
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
        ...(autoPlan ? { autoPlan: true } : {}),
        ...(parsed.flags.get('verify') === undefined ? {} : { verify: parsed.flags.get('verify') as string[] }),
        ...(parsed.flags.get('repo')?.[0] === undefined ? {} : { repo: parsed.flags.get('repo')?.[0] as string }),
        ...(parsed.flags.get('done')?.[0] === undefined
          ? {}
          : { definitionOfDone: parsed.flags.get('done')?.[0] as string }),
      });
      io.out(autoPlan ? `objective ${id} created — the planner proposes tasks on start` : `objective ${id} created with ${tasks.length} tasks`);
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

/**
 * `aeos sandbox build|status` (P4.M1): the container tier's runtime image.
 * The Dockerfile ships inside the CLI (drift-tested against
 * docker/runner/Dockerfile) so a fresh install can build it anywhere.
 */
function runSandboxCommand(action: string | undefined, parsed: Parsed, io: CliIo): number {
  const tag = parsed.flags.get('tag')?.[0] ?? 'aeos-runner:local';
  if (!dockerAvailable()) {
    io.err('docker is not reachable — the container sandbox tier needs a running docker daemon');
    return 1;
  }
  if (action === 'status') {
    const image = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], { encoding: 'utf8' });
    io.out(`docker: ok\nimage ${tag}: ${image.status === 0 ? image.stdout.trim() : 'missing — run `aeos sandbox build`'}`);
    return image.status === 0 ? 0 : 1;
  }
  if (action === 'build') {
    const result = spawnSync('docker', ['build', '-t', tag, '-'], { input: RUNNER_DOCKERFILE, stdio: ['pipe', 'inherit', 'inherit'] });
    if (result.status !== 0) return result.status ?? 1;
    io.out(`built ${tag}`);
    return 0;
  }
  io.err('usage: aeos sandbox build [--tag <image>] | aeos sandbox status');
  return 2;
}

/** `aeos plugin install|list|remove` (P4.M2) — local to AEOS_HOME, like `aeos harness`. */
function runPluginCommand(action: string | undefined, arg: string | undefined, io: CliIo): number {
  const home = process.env['AEOS_HOME'] ?? path.join(os.homedir(), '.aeos');
  try {
    if (action === 'install' && arg !== undefined) {
      const plugin = installPlugin(home, arg);
      const provides = plugin.manifest.contributes.map((c) => `${c.kind}:${c.id}`).join(', ');
      io.out(`installed ${plugin.name}@${plugin.version} (${provides}) — restart aeosd to load it`);
      return 0;
    }
    if (action === 'list') {
      for (const p of listInstalledPlugins(home)) {
        const provides = p.manifest.contributes.map((c) => `${c.kind}:${c.id}`).join(', ');
        io.out(`${p.name}@${p.version}  ${provides}${p.error === undefined ? '' : `  NOT LOADABLE (${p.error.code}): ${p.error.message}`}`);
      }
      return 0;
    }
    if (action === 'remove' && arg !== undefined) {
      io.out(removePlugin(home, arg) ? `removed ${arg}` : `${arg} is not installed`);
      return 0;
    }
  } catch (error) {
    io.err(error instanceof PluginError ? `${error.code}: ${error.message}` : String(error));
    return 1;
  }
  io.err('usage: aeos plugin install <spec> | aeos plugin list | aeos plugin remove <package>');
  return 2;
}

/** `aeos service install|uninstall|status` (P4.M3.T1). */
function runServiceCommand(action: string | undefined, parsed: Parsed, io: CliIo): number {
  const platform = currentPlatform();
  if (platform === undefined) {
    io.err(`aeos service supports Linux (systemd) and macOS (launchd); on ${process.platform} run aeosd under your own supervisor`);
    return 1;
  }
  const flag = (name: string): string | undefined => parsed.flags.get(name)?.[0];
  const home = process.env['AEOS_HOME'] ?? path.join(os.homedir(), '.aeos');
  const user = currentUser();
  if (action === 'install') {
    const host = flag('host');
    const tokenFile = flag('token-file');
    if (host !== undefined && !['127.0.0.1', 'localhost', '::1'].includes(host) && tokenFile === undefined) {
      io.err(`binding ${host} requires --token-file (aeosd refuses non-loopback binds without a token)`);
      return 2;
    }
    const plan = planInstall(
      {
        node: process.execPath,
        aeosd: resolveAeosd(flag('aeosd')),
        home,
        port: Number(flag('port') ?? 7777),
        ...(host === undefined ? {} : { host }),
        ...(tokenFile === undefined ? {} : { tokenFile: path.resolve(tokenFile) }),
      },
      platform,
      os.homedir(),
      user,
    );
    if (parsed.flags.has('dry-run')) {
      io.out(`# ${plan.file}\n${plan.content}`);
      for (const c of plan.commands) io.out(`$ ${c.argv.join(' ')}${c.optional === true ? '   # optional' : ''}`);
      return 0;
    }
    return applyPlan(plan, io, false);
  }
  if (action === 'uninstall') return applyPlan(planUninstall(platform, os.homedir(), user), io, true);
  if (action === 'status') {
    const argv = platform === 'linux' ? ['systemctl', '--user', 'status', 'aeosd.service', '--no-pager'] : ['launchctl', 'print', `gui/${String(user.uid)}/dev.aeos.aeosd`];
    const result = spawnSync(argv[0] as string, argv.slice(1), { encoding: 'utf8' });
    io.out((result.stdout || result.stderr || '').trimEnd());
    return result.status === 0 ? 0 : 1;
  }
  io.err('usage: aeos service install [--dry-run] | uninstall | status');
  return 2;
}
