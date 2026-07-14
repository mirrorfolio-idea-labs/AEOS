/**
 * Module lifecycle contract (spec §6): each module exports
 * `init(deps) → { start, stop, health }`; the composition root (apps/aeosd)
 * wires modules — nothing self-registers globally.
 */

export interface Health {
  ok: boolean;
  detail?: string;
}

export interface Module {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<Health>;
}

export interface KernelHealth {
  ok: boolean;
  modules: Record<string, Health>;
}

export interface Kernel {
  /** Starts modules in the given order; on failure stops the started ones in reverse and rethrows. */
  start(): Promise<void>;
  /** Stops modules in reverse start order; collects failures into an AggregateError. */
  stop(): Promise<void>;
  health(): Promise<KernelHealth>;
}

export function createKernel(modules: Module[]): Kernel {
  let started: Module[] = [];

  async function stopModules(toStop: Module[]): Promise<void> {
    const errors: unknown[] = [];
    for (const module of [...toStop].reverse()) {
      try {
        await module.stop();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'one or more modules failed to stop');
  }

  return {
    async start(): Promise<void> {
      for (const module of modules) {
        try {
          await module.start();
        } catch (error) {
          await stopModules(started).catch(() => undefined); // best-effort rollback
          started = [];
          throw error;
        }
        started = [...started, module];
      }
    },

    async stop(): Promise<void> {
      const toStop = started;
      started = [];
      await stopModules(toStop);
    },

    async health(): Promise<KernelHealth> {
      const entries = await Promise.all(
        modules.map(async (module): Promise<[string, Health]> => {
          try {
            return [module.name, await module.health()];
          } catch (error) {
            return [module.name, { ok: false, detail: error instanceof Error ? error.message : String(error) }];
          }
        }),
      );
      const moduleHealth = Object.fromEntries(entries);
      return { ok: entries.every(([, h]) => h.ok), modules: moduleHealth };
    },
  };
}
