import { describe, expect, it } from 'vitest';
import { BudgetMeter } from '../src/index.js';

describe('BudgetMeter', () => {
  it('never trips when no caps are configured', () => {
    const meter = new BudgetMeter({});
    expect(meter.record({ usd: 100, tokens: 1e9 }).exceeded).toBeNull();
  });

  it('trips the usd cap only when crossed', () => {
    const meter = new BudgetMeter({ usdCap: 0.01 });
    expect(meter.record({ usd: 0.004 }).exceeded).toBeNull();
    const reading = meter.record({ usd: 0.007 });
    expect(reading.exceeded).toBe('usd');
    expect(reading.totalUsd).toBeCloseTo(0.011);
  });

  it('trips the token cap independently', () => {
    const meter = new BudgetMeter({ tokenCap: 1000 });
    expect(meter.record({ tokens: 600 }).exceeded).toBeNull();
    expect(meter.record({ tokens: 401 }).exceeded).toBe('tokens');
  });

  it('caps at exactly the limit do NOT trip (strictly-greater semantics)', () => {
    const meter = new BudgetMeter({ usdCap: 0.01, tokenCap: 100 });
    expect(meter.record({ usd: 0.01, tokens: 100 }).exceeded).toBeNull();
  });
});
