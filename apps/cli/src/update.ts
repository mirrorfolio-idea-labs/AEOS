import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `aeos update` (P5.M6.T3). An install made by install.sh lives at
 * <installDir>/versions/<version>/, and its `aeos` launcher exports that
 * directory as AEOS_BUNDLE_DIR. The bundle ships the same verified installer
 * as bin/aeos-install, so an update re-runs exactly the install path:
 * checksum always, cosign signature when available.
 */
export interface UpdatePlan {
  installer: string;
  env: Record<string, string>;
}

export function planUpdate(
  env: Record<string, string | undefined>,
  version: string | undefined,
): UpdatePlan | { error: string } {
  const bundleDir = env['AEOS_BUNDLE_DIR'];
  const installer = bundleDir === undefined ? undefined : path.join(bundleDir, 'bin', 'aeos-install');
  if (bundleDir === undefined || installer === undefined || !fs.existsSync(installer)) {
    return {
      error:
        'aeos update only updates installs made by the AEOS installer (install.sh).\n' +
        'From a source checkout: git pull && pnpm install && pnpm build. From npm: npm i -g @aeos/cli@latest.',
    };
  }
  const versionsDir = path.dirname(path.resolve(bundleDir));
  if (path.basename(versionsDir) !== 'versions') {
    return { error: `AEOS_BUNDLE_DIR ${bundleDir} is not inside an installer-managed versions/ directory` };
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value;
  out['AEOS_INSTALL_DIR'] = path.dirname(versionsDir);
  if (version !== undefined) out['AEOS_VERSION'] = version.startsWith('v') ? version : `v${version}`;
  else delete out['AEOS_VERSION'];
  return { installer, env: out };
}

export function runUpdate(version: string | undefined, err: (line: string) => void): number {
  const plan = planUpdate(process.env, version);
  if ('error' in plan) {
    err(plan.error);
    return 1;
  }
  const result = spawnSync('sh', [plan.installer], { env: plan.env, stdio: 'inherit' });
  if (result.status === 0) err('updated. Restart aeosd (or `aeos service install` again) to run the new version.');
  return result.status ?? 1;
}
