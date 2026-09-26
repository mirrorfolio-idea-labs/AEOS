import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigSchema, type AeosEvent } from '@aeos/contracts';
import { PluginError, PluginHost, assertContract, createPluginRegistry, installPlugin, listInstalledPlugins, readPluginPackage, satisfies } from '../src/index.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-plugins-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const agent = AgentConfigSchema.parse({
  id: 'a1',
  workspaceId: 'ws',
  name: 'A',
  harness: { provider: 'plugin:p', featureToggles: {} },
  credentialProfileId: 'none',
});

/** Write a plugin package whose provider `p` runs `spawnBody` (JS) per spawn. */
function writePlugin(name: string, opts: { contract?: string; spawnBody?: string; top?: string } = {}): string {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name, version: '1.2.3', type: 'module', aeos: { contract: opts.contract ?? '^1', entry: './index.js', contributes: [{ kind: 'provider', id: 'p' }] } }),
  );
  fs.writeFileSync(
    path.join(root, 'index.js'),
    `${opts.top ?? ''}
export default { providers: { p: () => ({
  capabilities: () => ({ resume: false, structuredOutput: false, mcp: false, sandbox: false, costReporting: false }),
  createProfile: (a) => ({ rootDir: '/tmp/p/' + a.id, env: {}, argv: [] }),
  spawn: (opts) => ({ providerSessionId: 'ps', kill() {}, events: (async function* () { ${opts.spawnBody ?? "yield { type: 'session.created', payload: {} }; yield { type: 'session.completed', payload: {} };"} })() }),
}) } };
`,
  );
  return root;
}

async function drain(events: AsyncIterable<AeosEvent>): Promise<AeosEvent[]> {
  const out: AeosEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe('semver ranges for the contract gate', () => {
  it.each([
    ['1.0.0', '^1', true],
    ['1.4.2', '^1.2', true],
    ['2.0.0', '^1', false],
    ['1.0.0', '~1.0', true],
    ['1.1.0', '~1.0', false],
    ['1.0.0', '>=1.0.0 <2', true],
    ['2.0.0', '>=1.0.0 <2', false],
    ['1.0.0', '*', true],
    ['1.0.0', '1.0.0', true],
    ['1.0.1', '1.0', true],
    ['0.3.0', '^0.2', false],
  ])('%s satisfies %s → %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
  it('rejects ranges it does not understand instead of guessing', () => {
    expect(() => satisfies('1.0.0', '1.x || 2')).toThrow(/unsupported/);
  });
});

describe('manifest + contract gate (P4.M2.T1)', () => {
  it('accept: a version-mismatched plugin is refused with a typed error', () => {
    const plugin = readPluginPackage(writePlugin('future-plugin', { contract: '^2' }));
    let caught: unknown;
    try {
      assertContract(plugin, '1.0.0');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PluginError);
    expect(caught).toMatchObject({ code: 'contract_mismatch', plugin: 'future-plugin' });
  });

  it('bad manifests are typed too: not a plugin / invalid / entry escaping the package', () => {
    const plain = path.join(dir, 'plain');
    fs.mkdirSync(plain);
    fs.writeFileSync(path.join(plain, 'package.json'), '{"name":"plain"}');
    expect(() => readPluginPackage(plain)).toThrow(expect.objectContaining({ code: 'not_a_plugin' }));
    const root = writePlugin('bad');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bad', aeos: { contract: '^1', entry: '../../etc/x.js', contributes: [{ kind: 'provider', id: 'p' }] } }));
    expect(() => readPluginPackage(root)).toThrow(expect.objectContaining({ code: 'invalid_manifest' }));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bad', aeos: { contract: '^1', entry: './i.js', contributes: [{ kind: 'teleporter', id: 'p' }] } }));
    expect(() => readPluginPackage(root)).toThrow(expect.objectContaining({ code: 'invalid_manifest' }));
  });

  it('install refuses (and removes) a plugin built for another ABI; runs no install scripts', () => {
    const home = path.join(dir, 'home');
    const marker = path.join(dir, 'postinstall-ran');
    const root = writePlugin('future-plugin', { contract: '^2' });
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...pkg, scripts: { postinstall: `touch ${marker}` } }));
    expect(() => installPlugin(home, root)).toThrow(expect.objectContaining({ code: 'contract_mismatch' }));
    expect(listInstalledPlugins(home)).toEqual([]);
    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe('out-of-process isolation (P4.M2.T2)', () => {
  it('accept: a plugin that crashes mid-session fails that session and nothing else; the next call restarts it', async () => {
    const host = new PluginHost(
      readPluginPackage(
        writePlugin('crashy', {
          top: "let calls = 0;",
          spawnBody: "calls++; yield { type: 'session.created', payload: {} }; if (opts.objective === 'crash') process.exit(3); yield { type: 'session.completed', payload: {} };",
        }),
      ),
    );
    await host.start();
    const adapter = host.adapter('p');
    const profile = await adapter.createProfile(agent);

    const crashed = await drain(adapter.spawn({ profile, sessionId: 's1', objective: 'crash' }).events);
    expect(crashed.map((e) => e.type)).toEqual(['session.created', 'session.failed']);
    expect(JSON.stringify(crashed.at(-1)?.payload)).toMatch(/crashy exited \(code 3\)/);
    expect(host.state).toBe('crashed');
    // this process — "the daemon" — is still here, and the plugin comes back on demand
    const ok = await drain(adapter.spawn({ profile, sessionId: 's2', objective: 'fine' }).events);
    expect(ok.map((e) => e.type)).toEqual(['session.created', 'session.completed']);
    expect(ok.every((e) => e.sessionId === 's2' && e.source === 'plugin:p')).toBe(true);
    expect(host.state).toBe('running');
    host.close();
  });

  it('repeated crashes disable the plugin instead of crash-looping', async () => {
    const host = new PluginHost(readPluginPackage(writePlugin('doomed', { spawnBody: 'process.exit(1);' })), { maxCrashes: 2 });
    await host.start();
    const adapter = host.adapter('p');
    const profile = { rootDir: '/tmp/x', env: {}, argv: [] };
    await drain(adapter.spawn({ profile, sessionId: 's1', objective: 'x' }).events);
    await drain(adapter.spawn({ profile, sessionId: 's2', objective: 'x' }).events);
    expect(host.state).toBe('disabled');
    const refused = await drain(adapter.spawn({ profile, sessionId: 's3', objective: 'x' }).events);
    expect(refused.map((e) => e.type)).toEqual(['session.failed']);
    expect(JSON.stringify(refused[0]?.payload)).toMatch(/disabled after repeated crashes/);
    host.close();
  });

  it('the host is authoritative: an off-contract event ends the session', async () => {
    const host = new PluginHost(readPluginPackage(writePlugin('liar', { spawnBody: "yield { type: 'session.created', payload: {} }; yield { type: 'money.printed', payload: { usd: 1e9 } };" })));
    await host.start();
    const events = await drain(host.adapter('p').spawn({ profile: { rootDir: '/tmp/x', env: {}, argv: [] }, sessionId: 's', objective: 'x' }).events);
    expect(events.map((e) => e.type)).toEqual(['session.created', 'session.failed']);
    expect(JSON.stringify(events[1]?.payload)).toContain('outside the AEOS contract');
    host.close();
  });

  it('a plugin that fails to load is reported by the registry, never thrown at the daemon', async () => {
    const home = path.join(dir, 'home');
    const root = writePlugin('broken');
    fs.writeFileSync(path.join(root, 'index.js'), 'throw new Error("boom at import");');
    installPlugin(home, root);
    const registry = createPluginRegistry({ home });
    const [entry] = await registry.loadInstalled();
    expect(entry).toMatchObject({ name: 'broken', state: 'failed' });
    expect(entry?.error).toMatch(/boom at import/);
    expect(registry.provider('plugin:p')).toBeUndefined();
    registry.close();
  });
});
