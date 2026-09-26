import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createFileSecretStore } from '@aeos/secrets';
import { createDaemon } from './daemon.js';

/**
 * Thin executable edge: the ONLY place that reads process.env/argv or owns
 * signals. `aeosd` runs the daemon; `aeosd reindex` rebuilds index.db and
 * exits (spec §6 — the full `aeos` CLI arrives in M7).
 */
function resolveHome(): string {
  return process.env['AEOS_HOME'] ?? path.join(os.homedir(), '.aeos');
}

/**
 * The API bearer token: `AEOS_API_TOKEN`, or the first line of the file
 * named by `AEOS_API_TOKEN_FILE` (docker/compose/k8s secrets).
 */
function apiToken(): string | undefined {
  const file = process.env['AEOS_API_TOKEN_FILE'];
  if (file !== undefined) {
    const token = fs.readFileSync(file, 'utf8').split('\n')[0]?.trim();
    if (token === undefined || token.length < 16) throw new Error(`AEOS_API_TOKEN_FILE ${file} holds no token (16+ chars required)`);
    return token;
  }
  return process.env['AEOS_API_TOKEN'];
}

const KNOWN_PROVIDERS = new Set(['fake', 'claude-code', 'opencode', 'codex']);

async function main(): Promise<number> {
  const command = process.argv[2] ?? 'run';
  // an empty value (e.g. compose's `${AEOS_PROVIDER:-}`) means unset
  const providerOverride = process.env['AEOS_PROVIDER'] === '' ? undefined : process.env['AEOS_PROVIDER'];
  if (providerOverride !== undefined && !KNOWN_PROVIDERS.has(providerOverride)) {
    console.error(`unknown AEOS_PROVIDER '${providerOverride}' (expected fake | claude-code | opencode)`);
    return 2;
  }
  const uiDir =
    process.env['AEOS_UI_DIR'] ??
    path.resolve(import.meta.dirname, '..', '..', 'ade', 'dist');
  // reindex boots kernel-only: no listener, no resume-on-boot
  const apiConfig = command !== 'run' ? undefined : {
      port: Number(process.env['AEOS_PORT'] ?? 7777),
      ...(process.env['AEOS_HOST'] === undefined ? {} : { host: process.env['AEOS_HOST'] }),
      ...(apiToken() === undefined ? {} : { token: apiToken() as string }),
      ...(providerOverride === undefined
        ? {}
        : { providerOverride: providerOverride as 'fake' | 'claude-code' | 'opencode' | 'codex' }),
      uiDir,
      ...(process.env['AEOS_FAKE_PACE_MS'] === undefined
        ? {}
        : { fakePaceMs: Number(process.env['AEOS_FAKE_PACE_MS']) }),
      ...(process.env['AEOS_APPROVAL_TIMEOUT_MS'] === undefined
        ? {}
        : { approvalTimeoutMs: Number(process.env['AEOS_APPROVAL_TIMEOUT_MS']) }),
      // opt-in store attachment (spec §11): boot enumerates <home>/secrets
      // into the redaction registry and backs non-env credential refs
      ...(process.env['AEOS_SECRETS_STORE'] !== '1'
        ? {}
        : { secretStore: createFileSecretStore(resolveHome()) }),
      env: process.env,
    };
  const daemon = createDaemon({
    home: resolveHome(),
    ...(process.env['AEOS_WAKEUP_TICK_MS'] === undefined ? {} : { wakeupTickMs: Number(process.env['AEOS_WAKEUP_TICK_MS']) }),
    ...(apiConfig === undefined ? {} : { api: apiConfig }),
    // opt-in curator (P2.M4): dry-run idle trigger; apply mode lands in T2
    ...(process.env['AEOS_CURATOR'] !== '1'
      ? {}
      : {
          curator: {
            idleMs: Number(process.env['AEOS_CURATOR_IDLE_MS'] ?? 900_000),
            minIntervalMs: Number(process.env['AEOS_CURATOR_MIN_INTERVAL_MS'] ?? 21_600_000),
          },
        }),
  });

  if (command === 'reindex') {
    await daemon.start();
    const report = daemon.reindex();
    console.error(
      `reindexed: ${report.agents} agents, ${report.sessions} sessions, ${report.corrupt.length} corrupt`,
    );
    for (const c of report.corrupt) console.error(`  corrupt: ${c.path} — ${c.message}`);
    await daemon.stop();
    return report.corrupt.length > 0 ? 1 : 0;
  }

  if (command !== 'run') {
    console.error(`unknown command '${command}' (expected: run | reindex)`);
    return 2;
  }

  await daemon.start();
  const health = await daemon.health();
  if (!health.ok) {
    console.error('self-check failed:', JSON.stringify(health.modules));
    await daemon.stop();
    return 1;
  }
  console.error(`aeosd ready (home: ${resolveHome()}, api: ${daemon.apiAddress() ?? 'off'})`);

  await new Promise<void>((resolve) => {
    const shutdown = (): void => resolve();
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  await daemon.stop();
  console.error('aeosd stopped');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('aeosd failed to boot:', error);
    process.exit(1);
  },
);
