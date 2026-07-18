import { Runner, type RunnerOptions } from './runner.js';

/**
 * Runner executable: `node main.js '<config-json>'`. Spawned detached by the
 * supervisor; lives independently of the daemon. Exits on its own a grace
 * period after the child ends (late daemons replay from the transcript file),
 * or immediately on SIGTERM/SIGINT.
 */

interface MainConfig extends RunnerOptions {
  exitGraceMs?: number;
}

function fatal(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const configJson = process.argv[2];
if (configJson === undefined) fatal('usage: main.js <config-json>');

let config: MainConfig;
try {
  config = JSON.parse(configJson) as MainConfig;
} catch (error) {
  fatal(`invalid config JSON: ${String(error)}`);
}

const runner = new Runner(config);
await runner.start();

let closing = false;
async function shutdown(code: number): Promise<never> {
  if (closing) process.exit(code);
  closing = true;
  try {
    await runner.close();
    process.exit(code);
  } catch {
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown(0));
process.on('SIGINT', () => void shutdown(0));

void runner.waitForChildExit().then(() => {
  setTimeout(() => void shutdown(0), config.exitGraceMs ?? 30_000).unref();
});
