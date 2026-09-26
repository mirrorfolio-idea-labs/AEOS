import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planInstall, planUninstall, renderLaunchdPlist, renderSystemdUnit } from '../src/service.js';

const spec = { node: '/usr/bin/node', aeosd: '/opt/aeos/aeosd/dist/main.js', home: '/home/kb/.aeos', port: 7777 };

describe('aeos service (P4.M3.T1)', () => {
  it('systemd user unit: restarts on failure, starts at login, never kills detached runners', () => {
    const unit = renderSystemdUnit(spec);
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/aeos/aeosd/dist/main.js run');
    expect(unit).toContain('Environment=AEOS_HOME=/home/kb/.aeos');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('KillMode=process');
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).not.toContain('AEOS_API_TOKEN=');
  });

  it('quotes paths with spaces/quotes and passes the token by FILE, never by value', () => {
    const unit = renderSystemdUnit({ ...spec, home: '/Users/K B/"aeos"', host: '0.0.0.0', tokenFile: '/etc/aeos/token' });
    expect(unit).toContain('Environment="AEOS_HOME=/Users/K B/\\"aeos\\""');
    expect(unit).toContain('Environment=AEOS_HOST=0.0.0.0');
    expect(unit).toContain('Environment=AEOS_API_TOKEN_FILE=/etc/aeos/token');
  });

  it('systemd-analyze accepts the unit (when available)', () => {
    const probe = spawnSync('systemd-analyze', ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-unit-'));
    const file = path.join(dir, 'aeosd.service');
    // verify needs the ExecStart binary to exist — point it at this node
    fs.writeFileSync(file, renderSystemdUnit({ ...spec, node: process.execPath, aeosd: file }));
    const result = spawnSync('systemd-analyze', ['verify', file], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    const problems = `${result.stdout}${result.stderr}`.split('\n').filter((l) => l.includes('aeosd.service') && !/not executable|Failed to connect|Command .* is not/.test(l));
    expect(problems, `${result.stdout}${result.stderr}`).toEqual([]);
  });

  it('launchd agent: RunAtLoad + KeepAlive on failure + AbandonProcessGroup; values XML-escaped', () => {
    const plist = renderLaunchdPlist({ ...spec, home: '/Users/k&b/<aeos>' });
    expect(plist).toContain('<key>Label</key><string>dev.aeos.aeosd</string>');
    expect(plist).toContain('<key>RunAtLoad</key><true/>');
    expect(plist).toContain('<dict><key>SuccessfulExit</key><false/></dict>');
    expect(plist).toContain('<key>AbandonProcessGroup</key><true/>');
    expect(plist).toContain('<string>/Users/k&amp;b/&lt;aeos&gt;</string>');
    expect(plist).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it('install/uninstall plans per platform', () => {
    const linux = planInstall(spec, 'linux', '/home/kb', { name: 'kb', uid: 1000 });
    expect(linux.file).toBe('/home/kb/.config/systemd/user/aeosd.service');
    expect(linux.commands.map((c) => c.argv.join(' '))).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable --now aeosd.service',
      'loginctl enable-linger kb',
    ]);
    expect(linux.commands[2]?.optional).toBe(true);
    const mac = planInstall(spec, 'darwin', '/Users/kb', { name: 'kb', uid: 501 });
    expect(mac.file).toBe('/Users/kb/Library/LaunchAgents/dev.aeos.aeosd.plist');
    expect(mac.commands.at(-1)?.argv).toEqual(['launchctl', 'bootstrap', 'gui/501', mac.file]);
    expect(planUninstall('linux', '/home/kb', { uid: 1000 }).commands[0]?.argv).toEqual(['systemctl', '--user', 'disable', '--now', 'aeosd.service']);
  });
});
