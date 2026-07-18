import fs from 'node:fs';
import {
  aeosYamlPath,
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

export interface DaemonConfig {
  home: string;
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

  const kernel = createKernel([
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
        bus = createEventBus();
        // runner-owned sessions write their own transcript (spec §10) — the
        // daemon must not double-append while a live runner exists
        detachTranscript = attachTranscriptWriter(bus, home, deps.db, {
          skipSession: (sessionId) => supervisor?.hasLiveRunner(sessionId) ?? false,
        });
      },
      stop: async () => {
        detachTranscript?.();
        detachTranscript = undefined;
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
  ]);

  return {
    start: () => kernel.start(),
    stop: () => kernel.stop(),
    health: () => kernel.health(),
    reindex: () => reindex(home, deps.db),
    deps,
  };
}
