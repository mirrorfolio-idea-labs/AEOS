import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PluginError, assertContract, readPluginPackage, type PluginPackage } from './manifest.js';

/** `<home>/plugins` — a private npm prefix holding every installed plugin. */
export const pluginsRoot = (home: string): string => path.join(home, 'plugins');

function ensureRoot(home: string): string {
  const root = pluginsRoot(home);
  fs.mkdirSync(root, { recursive: true });
  const pkg = path.join(root, 'package.json');
  if (!fs.existsSync(pkg)) {
    fs.writeFileSync(pkg, JSON.stringify({ name: 'aeos-plugins', private: true, dependencies: {} }, null, 2) + '\n');
  }
  return root;
}

function dependencies(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    return pkg.dependencies ?? {};
  } catch {
    return {};
  }
}

function npm(root: string, args: string[]): void {
  const result = spawnSync('npm', [...args, '--prefix', root, '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300_000,
  });
  if (result.status !== 0) {
    throw new PluginError('install_failed', `npm ${args.join(' ')} failed: ${(result.stderr || result.stdout || String(result.error ?? '')).trim().slice(-2000)}`);
  }
}

export interface InstalledPlugin extends PluginPackage {
  /** Why it will not load (bad manifest / contract mismatch), when it will not. */
  error?: PluginError;
}

/**
 * Install a third-party plugin (P4.M2.T2) from an npm spec or a local
 * tarball/directory into `<home>/plugins`. Lifecycle scripts never run
 * (`--ignore-scripts`: installing is not executing). A package without a
 * valid manifest, or built for another plugin ABI, is uninstalled again and
 * refused with a typed PluginError.
 */
export function installPlugin(home: string, spec: string): PluginPackage {
  const root = ensureRoot(home);
  const before = dependencies(root);
  const source = fs.existsSync(spec) ? path.resolve(spec) : spec;
  npm(root, ['install', source]);
  const after = dependencies(root);
  const added = Object.keys(after).filter((name) => before[name] !== after[name]);
  const name = added[0] ?? Object.keys(after).find((n) => after[n] === source || after[n]?.endsWith(path.basename(source)));
  if (name === undefined) throw new PluginError('install_failed', `could not tell which package "${spec}" installed`);
  try {
    const plugin = readPluginPackage(path.join(root, 'node_modules', name));
    assertContract(plugin);
    return plugin;
  } catch (error) {
    npm(root, ['uninstall', name]);
    throw error;
  }
}

export function removePlugin(home: string, name: string): boolean {
  const root = pluginsRoot(home);
  if (dependencies(root)[name] === undefined) return false;
  npm(root, ['uninstall', name]);
  return true;
}

/** Every installed plugin, loadable or not (errors are reported, not thrown). */
export function listInstalledPlugins(home: string): InstalledPlugin[] {
  const root = pluginsRoot(home);
  const out: InstalledPlugin[] = [];
  for (const name of Object.keys(dependencies(root)).sort()) {
    const dir = path.join(root, 'node_modules', name);
    try {
      const plugin = readPluginPackage(dir);
      try {
        assertContract(plugin);
        out.push(plugin);
      } catch (error) {
        out.push({ ...plugin, error: error as PluginError });
      }
    } catch (error) {
      out.push({
        name,
        version: '0.0.0',
        root: dir,
        entry: dir,
        manifest: { contract: '*', entry: '.', contributes: [{ kind: 'provider', id: 'unknown' }] },
        error: error instanceof PluginError ? error : new PluginError('load_failed', String(error), name),
      });
    }
  }
  return out;
}
