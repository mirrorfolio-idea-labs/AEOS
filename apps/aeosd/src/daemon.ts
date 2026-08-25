import fs from 'node:fs';
import {
  aeosYamlPath,
  attachAuditWriter,
  attachRedaction,
  attachTranscriptWriter,
  auditDir,
  createEventBus,
  createKernel,
  openIndexDb,
  reindex,
  writeFileAtomic,
  type EventBus,
  type IndexDb,
  type KernelHealth,
  type ReindexReport,
} from '@aeos/kernel';
import { createSupervisor, type Supervisor } from '@aeos/runner';
import type { Module } from '@aeos/kernel';
import { startApiModule, type ApiModuleConfig, type ApiModuleHandle } from './api-module.js';

export interface DaemonConfig {
  home: string;
  /** Mount the HTTP API + UI + resume-on-boot (M7–M9). Omit for kernel-only boots (tests). */
  api?: ApiModuleConfig;
}

/** Wiring exposed for tests and, later, the API layer (M7). */
export interface DaemonDeps {
  home: string;
  db: IndexDb;
  bus: EventBus;
  supervisor: Supervisor;
}

export interface Daemon {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<KernelHealth>;
  reindex(): ReindexReport;
  deps: DaemonDeps;
  /** Set once started with an `api` config. */
  apiAddress(): string | undefined;
}

const DEFAULT_AEOS_YAML = 'v: 1\n';

/**
 * Composition root (spec §6): wires home layout → derived index → event bus →
 * transcript writer as lifecycle modules. No module self-registers; nothing
 * here reads process.env (main.ts owns that edge).
 */
export function createDaemon(config: DaemonConfig): Daemon {
  const { home } = config;
  let db: IndexDb | undefined;
  let bus: EventBus | undefined;
  let supervisor: Supervisor | undefined;
  let detachTranscript: (() => void) | undefined;
  let detachAudit: (() => void) | undefined;
  let api: ApiModuleHandle | undefined;

  const deps: DaemonDeps = {
    home,
    get db(): IndexDb {
      if (db === undefined) throw new Error('daemon not started');
      return db;
    },
    get bus(): EventBus {
      if (bus === undefined) throw new Error('daemon not started');
      return bus;
    },
    get supervisor(): Supervisor {
      if (supervisor === undefined) throw new Error('daemon not started');
      return supervisor;
    },
  };

  const coreModules: Module[] = [
    {
      name: 'home',
      start: async () => {
        fs.mkdirSync(home, { recursive: true });
        fs.mkdirSync(auditDir(home), { recursive: true });
        if (!fs.existsSync(aeosYamlPath(home))) {
          writeFileAtomic(aeosYamlPath(home), DEFAULT_AEOS_YAML);
        }
      },
      stop: async () => undefined,
      health: async () =>
        fs.existsSync(aeosYamlPath(home))
          ? { ok: true }
          : { ok: false, detail: 'aeos.yaml missing' },
    },
    {
      name: 'index-db',
      start: async () => {
        db = openIndexDb(home);
      },
      stop: async () => {
        db?.close();
        db = undefined;
      },
      health: async () => {
        try {
          deps.db.prepare('SELECT 1').get();
          return { ok: true };
        } catch (error) {
          return { ok: false, detail: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    {
      name: 'event-bus',
      start: async () => {
        // spec §11 redaction: scrub registered secret values before ANY
        // subscriber (transcript, audit, SSE, REST) ever sees an event
        const redactionValues = new Set<string>();
        if (config.api?.secretStore !== undefined) {
          for (const ref of await config.api.secretStore.list()) {
            try {
              redactionValues.add(await config.api.secretStore.get(ref));
            } catch {
              // unreadable refs simply don't register — the store stays locked
            }
          }
        }
        const redactingBus = attachRedaction(createEventBus(), () => redactionValues);
        bus = redactingBus;
        if (config.api !== undefined) {
          (config.api as ApiModuleConfig).registerSecretValue = (value: string): void => {
            redactionValues.add(value);
          };
        }
        // runner-owned sessions write their own transcript (spec §10) — the
        // daemon must not double-append while a live runner exists
        detachTranscript = attachTranscriptWriter(redactingBus, home, deps.db, {
          skipSession: (sessionId) => supervisor?.hasLiveRunner(sessionId) ?? false,
        });
        detachAudit = attachAuditWriter(redactingBus, home);
      },
      stop: async () => {
        detachTranscript?.();
        detachTranscript = undefined;
        detachAudit?.();
        detachAudit = undefined;
        bus = undefined;
      },
      health: async () => (bus !== undefined ? { ok: true } : { ok: false, detail: 'bus not created' }),
    },
    {
      name: 'supervisor',
      start: async () => {
        supervisor = createSupervisor({ home, db: deps.db, bus: deps.bus });
        await supervisor.adoptOrphans(); // boot-time re-adoption (spec §10)
      },
      stop: async () => {
        // drops connections only — runners are separate processes and live on
        supervisor?.close();
        supervisor = undefined;
      },
      health: async () =>
        supervisor !== undefined ? { ok: true } : { ok: false, detail: 'supervisor not created' },
    },
  ];

  // The api module only exists when configured — kernel-only boots (tests,
  // `reindex`) keep the exact module set they had before M9.
  const apiModule: Module[] = config.api === undefined ? [] : [
    {
      name: 'api',
      start: async () => {
        api = await startApiModule(home, deps.db, deps.bus, config.api as ApiModuleConfig);
        if (api.resumed.length > 0) {
          console.error(`resume-on-boot: ${api.resumed.join(', ')}`);
        }
      },
      stop: async () => {
        await api?.close();
        api = undefined;
      },
      health: async () =>
        api !== undefined ? { ok: true } : { ok: false, detail: 'api not mounted' },
    },
  ];

  const kernel = createKernel([...coreModules, ...apiModule]);

  return {
    start: () => kernel.start(),
    stop: () => kernel.stop(),
    health: () => kernel.health(),
    reindex: () => reindex(home, deps.db),
    deps,
    apiAddress: () => api?.address,
  };
}
