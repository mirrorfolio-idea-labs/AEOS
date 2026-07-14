import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createDaemon } from './daemon.js';

/**
 * Thin executable edge: the ONLY place that reads process.env/argv or owns
 * signals. `aeosd` runs the daemon; `aeosd reindex` rebuilds index.db and
 * exits (spec §6 — the full `aeos` CLI arrives in M7).
 */
function resolveHome(): string {
  return process.env['AEOS_HOME'] ?? path.join(os.homedir(), '.aeos');
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? 'run';
  const daemon = createDaemon({ home: resolveHome() });

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
  console.error(`aeosd ready (home: ${resolveHome()})`);

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
