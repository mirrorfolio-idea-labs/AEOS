import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planUpdate } from '../src/update.js';

describe('aeos update (P5.M6.T3)', () => {
  it('re-runs the bundled installer against the same install directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-update-'));
    const bundle = path.join(root, 'app', 'versions', '0.4.0');
    fs.mkdirSync(path.join(bundle, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'bin', 'aeos-install'), '#!/bin/sh\n');

    const latest = planUpdate({ AEOS_BUNDLE_DIR: bundle, AEOS_VERSION: 'v0.1.0', HOME: '/h' }, undefined);
    expect(latest).toEqual({
      installer: path.join(bundle, 'bin', 'aeos-install'),
      env: { AEOS_BUNDLE_DIR: bundle, HOME: '/h', AEOS_INSTALL_DIR: path.join(root, 'app') },
    });

    const pinned = planUpdate({ AEOS_BUNDLE_DIR: bundle }, '1.0.0-rc.1');
    expect('env' in pinned && pinned.env['AEOS_VERSION']).toBe('v1.0.0-rc.1');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses installs it did not make, with the right way to update them', () => {
    const none = planUpdate({}, undefined);
    expect('error' in none && none.error).toMatch(/only updates installs made by the AEOS installer/);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-update-'));
    fs.mkdirSync(path.join(root, 'loose', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'loose', 'bin', 'aeos-install'), '#!/bin/sh\n');
    const loose = planUpdate({ AEOS_BUNDLE_DIR: path.join(root, 'loose') }, undefined);
    expect('error' in loose && loose.error).toMatch(/not inside an installer-managed versions/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
