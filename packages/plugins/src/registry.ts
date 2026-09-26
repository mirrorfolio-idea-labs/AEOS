import { PLUGIN_ABI_VERSION, type PluginManifest } from '@aeos/contracts';
import type { HarnessAdapter } from '@aeos/provider-core';
import { PluginHost, type PluginHostOptions } from './host.js';
import { listInstalledPlugins } from './install.js';
import { PluginError, assertContract, type PluginPackage } from './manifest.js';

/** Builds a HarnessAdapter for an agent; `opts` is whatever the composition root passes. */
export type ProviderFactory<Opts> = (agent: Parameters<HarnessAdapter['createProfile']>[0], opts: Opts) => HarnessAdapter;

export interface PluginEntry {
  name: string;
  version: string;
  origin: 'core' | 'installed';
  providers: string[];
  state: 'running' | 'crashed' | 'disabled' | 'stopped' | 'failed';
  error?: string;
}

export interface PluginRegistry<Opts> {
  /**
   * Register a first-party plugin (spec §15: core plugins use the SAME
   * mechanism — manifest + contract gate — as third parties).
   */
  registerCore(pkg: { name: string; version: string; manifest: PluginManifest }, providers: Record<string, ProviderFactory<Opts>>): void;
  /** Start every installed plugin in its own process; failures are reported, never fatal. */
  loadInstalled(): Promise<PluginEntry[]>;
  /** Provider factory by id (`claude-code`, `plugin:echo`, …). */
  provider(id: string): ProviderFactory<Opts> | undefined;
  list(): PluginEntry[];
  close(): void;
}

export function createPluginRegistry<Opts>(opts: { home: string; host?: PluginHostOptions; log?: (line: string) => void }): PluginRegistry<Opts> {
  const providers = new Map<string, ProviderFactory<Opts>>();
  const entries: PluginEntry[] = [];
  const hosts: PluginHost[] = [];
  const claim = (id: string, owner: string): void => {
    if (providers.has(id)) throw new PluginError('invalid_manifest', `${owner}: provider "${id}" is already registered`, owner);
  };

  return {
    registerCore(pkg, factories) {
      assertContract({ ...pkg, root: '', entry: '' } as PluginPackage, PLUGIN_ABI_VERSION);
      for (const [id, factory] of Object.entries(factories)) {
        claim(id, pkg.name);
        providers.set(id, factory);
      }
      entries.push({ name: pkg.name, version: pkg.version, origin: 'core', providers: Object.keys(factories), state: 'running' });
    },

    async loadInstalled() {
      const loaded: PluginEntry[] = [];
      for (const plugin of listInstalledPlugins(opts.home)) {
        const declared = plugin.manifest.contributes.filter((c) => c.kind === 'provider').map((c) => `plugin:${c.id}`);
        const entry: PluginEntry = { name: plugin.name, version: plugin.version, origin: 'installed', providers: declared, state: 'failed' };
        entries.push(entry);
        loaded.push(entry);
        if (plugin.error !== undefined) {
          entry.error = `${plugin.error.code}: ${plugin.error.message}`;
          opts.log?.(`plugins: ${plugin.name} not loaded — ${entry.error}`);
          continue;
        }
        const host = new PluginHost(plugin, { ...opts.host, ...(opts.log === undefined ? {} : { log: opts.log }) });
        hosts.push(host);
        try {
          const described = await host.start();
          for (const c of plugin.manifest.contributes.filter((x) => x.kind === 'provider')) {
            const id = `plugin:${c.id}`;
            if (described[c.id] === undefined) throw new PluginError('load_failed', `${plugin.name} declares provider "${c.id}" but does not export it`, plugin.name);
            claim(id, plugin.name);
            // after a crash the proxy restarts the child on its next call;
            // only a plugin disabled for repeated crashes is refused
            providers.set(id, () => {
              if (host.state === 'disabled') throw new PluginError('load_failed', `plugin ${plugin.name} is ${host.state}: ${host.lastError ?? ''}`, plugin.name);
              return host.adapter(c.id);
            });
          }
          entry.state = 'running';
        } catch (error) {
          entry.error = error instanceof Error ? error.message : String(error);
          opts.log?.(`plugins: ${plugin.name} failed to start — ${entry.error}`);
          host.close();
        }
      }
      return loaded;
    },

    provider: (id) => providers.get(id),

    list: () =>
      entries.map((e) => {
        const host = hosts.find((h) => h.plugin.name === e.name);
        return host === undefined || e.state === 'failed' ? e : { ...e, state: host.state, ...(host.lastError === undefined ? {} : { error: host.lastError }) };
      }),

    close() {
      for (const host of hosts) host.close();
    },
  };
}
