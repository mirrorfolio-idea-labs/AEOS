import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AgentConfigSchema } from '@aeos/contracts';
import { createPluginRegistry, listInstalledPlugins } from '@aeos/plugins';
import { describeAdapterConformance } from '@aeos/provider-core/conformance';
// @ts-expect-error — plain-JS bin, no types
import { scaffold } from '../bin/create-aeos-plugin.mjs';

/**
 * P4.M2 exit gate (T3 accept): `create-aeos-plugin` scaffolds a plugin; it
 * is packed to a TARBALL, installed like any third-party plugin, loaded in
 * its own process, and its provider passes the SAME conformance suite the
 * first-party adapters do — without touching AEOS core.
 */
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-plugin-e2e-'));
const home = path.join(work, 'home');
const { dir } = (scaffold as (d: string, o: object) => { dir: string })(path.join(work, 'aeos-plugin-echo'), { id: 'echo' });
const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', work], { cwd: dir, encoding: 'utf8' }).trim().split('\n').at(-1) as string;
execFileSync(process.execPath, [path.join(import.meta.dirname, '..', '..', '..', 'apps', 'cli', 'dist', 'main.js'), 'plugin', 'install', path.join(work, tarball)], {
  env: { ...process.env, AEOS_HOME: home },
  stdio: 'ignore',
});
const registry = createPluginRegistry({ home });
const loaded = await registry.loadInstalled();

afterAll(() => {
  registry.close();
  fs.rmSync(work, { recursive: true, force: true });
});

describe('create-aeos-plugin template, installed from a tarball', () => {
  it('installs via `aeos plugin install` and loads as plugin:echo in its own process', () => {
    expect(listInstalledPlugins(home).map((p) => `${p.name}@${p.version}`)).toEqual(['aeos-plugin-echo@0.1.0']);
    expect(loaded).toMatchObject([{ name: 'aeos-plugin-echo', origin: 'installed', providers: ['plugin:echo'], state: 'running' }]);
    expect(registry.provider('plugin:echo')).toBeDefined();
  });
});

const agent = AgentConfigSchema.parse({
  id: 'echo-agent',
  workspaceId: 'ws',
  name: 'Echo',
  harness: { provider: 'plugin:echo', featureToggles: {} },
  credentialProfileId: 'none',
});
describeAdapterConformance('plugin:echo (third-party, out of process)', {
  makeAdapter: () => (registry.provider('plugin:echo') as (a: typeof agent, o: object) => ReturnType<NonNullable<ReturnType<typeof registry.provider>>>)(agent, {}),
  agent,
  rawCorpus: [{ text: 'hello' }, { nothing: true }, null, 'raw line'],
  capabilityClaims: { resume: false, structuredOutput: true, mcp: false, sandbox: false, costReporting: true, costUsd: true },
});
