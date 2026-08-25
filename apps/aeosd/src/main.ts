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

const KNOWN_PROVIDERS = new Set(['fake', 'claude-code', 'opencode']);

async function main(): Promise<number> {
  const command = process.argv[2] ?? 'run';
  const providerOverride = process.env['AEOS_PROVIDER'];
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
      ...(process.env['AEOS_API_TOKEN'] === undefined
        ? {}
        : { token: process.env['AEOS_API_TOKEN'] }),
      ...(providerOverride === undefined
        ? {}
        : { providerOverride: providerOverride as 'fake' | 'claude-code' | 'opencode' }),
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
    ...(apiConfig === undefined ? {} : { api: apiConfig }),
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
