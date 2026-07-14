import { describe, expect, it } from 'vitest';
import { createKernel, type Module } from '../src/index.js';

function mod(
  name: string,
  log: string[],
  opts: { failStart?: boolean; unhealthy?: boolean } = {},
): Module {
  return {
    name,
    start: async () => {
      if (opts.failStart) throw new Error(`${name} refused to start`);
      log.push(`start:${name}`);
    },
    stop: async () => {
      log.push(`stop:${name}`);
    },
    health: async () => (opts.unhealthy ? { ok: false, detail: 'sick' } : { ok: true }),
  };
}

describe('module lifecycle kernel', () => {
  it('starts in order, stops in reverse', async () => {
    const log: string[] = [];
    const kernel = createKernel([mod('a', log), mod('b', log), mod('c', log)]);
    await kernel.start();
    await kernel.stop();
    expect(log).toEqual(['start:a', 'start:b', 'start:c', 'stop:c', 'stop:b', 'stop:a']);
  });

  it('a failed start rolls back already-started modules in reverse', async () => {
    const log: string[] = [];
    const kernel = createKernel([mod('a', log), mod('b', log, { failStart: true }), mod('c', log)]);
    await expect(kernel.start()).rejects.toThrow('b refused to start');
    expect(log).toEqual(['start:a', 'stop:a']);
  });

  it('health aggregates across modules', async () => {
    const log: string[] = [];
    const kernel = createKernel([mod('a', log), mod('b', log, { unhealthy: true })]);
    await kernel.start();
    const health = await kernel.health();
    expect(health.ok).toBe(false);
    expect(health.modules['a']).toEqual({ ok: true });
    expect(health.modules['b']).toEqual({ ok: false, detail: 'sick' });
    await kernel.stop();
  });
});
