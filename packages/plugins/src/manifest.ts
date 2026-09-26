import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ABI_VERSION, PluginManifestSchema, type PluginManifest } from '@aeos/contracts';
import { satisfies } from './semver.js';

export type PluginErrorCode = 'not_a_plugin' | 'invalid_manifest' | 'contract_mismatch' | 'install_failed' | 'load_failed';

/** Typed plugin failure (P4.M2) — callers branch on `code`, never on message text. */
export class PluginError extends Error {
  constructor(
    readonly code: PluginErrorCode,
    message: string,
    readonly plugin?: string,
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

export interface PluginPackage {
  name: string;
  version: string;
  /** Absolute package root. */
  root: string;
  manifest: PluginManifest;
  /** Absolute path of the entry module. */
  entry: string;
}

/** Read and validate `<root>/package.json`'s `aeos` manifest (no contract check). */
export function readPluginPackage(root: string): PluginPackage {
  let pkg: { name?: unknown; version?: unknown; aeos?: unknown };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as typeof pkg;
  } catch (error) {
    throw new PluginError('not_a_plugin', `no readable package.json in ${root}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const name = typeof pkg.name === 'string' ? pkg.name : path.basename(root);
  if (pkg.aeos === undefined) throw new PluginError('not_a_plugin', `${name} has no "aeos" manifest in package.json`, name);
  const parsed = PluginManifestSchema.safeParse(pkg.aeos);
  if (!parsed.success) {
    throw new PluginError('invalid_manifest', `${name}: invalid "aeos" manifest — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, name);
  }
  const entry = path.resolve(root, parsed.data.entry);
  if (!entry.startsWith(path.resolve(root) + path.sep)) {
    throw new PluginError('invalid_manifest', `${name}: entry "${parsed.data.entry}" escapes the package`, name);
  }
  return { name, version: typeof pkg.version === 'string' ? pkg.version : '0.0.0', root: path.resolve(root), manifest: parsed.data, entry };
}

/**
 * Contract-version gate (P4.M2.T1): the plugin's declared `contract` range
 * must admit this build's PLUGIN_ABI_VERSION, else a typed
 * `contract_mismatch` — never a half-loaded plugin.
 */
export function assertContract(plugin: PluginPackage, abiVersion: string = PLUGIN_ABI_VERSION): void {
  let ok: boolean;
  try {
    ok = satisfies(abiVersion, plugin.manifest.contract);
  } catch (error) {
    throw new PluginError('invalid_manifest', `${plugin.name}: ${error instanceof Error ? error.message : String(error)}`, plugin.name);
  }
  if (!ok) {
    throw new PluginError(
      'contract_mismatch',
      `${plugin.name}@${plugin.version} targets AEOS plugin ABI "${plugin.manifest.contract}", but this AEOS provides ${abiVersion}`,
      plugin.name,
    );
  }
}
