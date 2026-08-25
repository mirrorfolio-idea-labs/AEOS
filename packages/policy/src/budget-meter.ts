/**
 * Pure spend accounting for budget enforcement (spec §11). No I/O, no clock:
 * the caller decides what a "hard stop" means. Both caps are optional; a
 * missing cap never trips.
 */
export interface Spend {
  usd: number;
  tokens: number;
}

export interface BudgetCaps {
  usdCap?: number;
  tokenCap?: number;
}

export interface MeterReading {
  totalUsd: number;
  totalTokens: number;
  /** Which cap was crossed by the most recent record, if any. */
  exceeded: 'usd' | 'tokens' | null;
}

export class BudgetMeter {
  private totalUsd = 0;
  private totalTokens = 0;

  constructor(private readonly caps: BudgetCaps) {}

  record(spend: Partial<Spend>): MeterReading {
    this.totalUsd += spend.usd ?? 0;
    this.totalTokens += spend.tokens ?? 0;

    let exceeded: 'usd' | 'tokens' | null = null;
    if (this.caps.usdCap !== undefined && this.totalUsd > this.caps.usdCap) {
      exceeded = 'usd';
    } else if (this.caps.tokenCap !== undefined && this.totalTokens > this.caps.tokenCap) {
      exceeded = 'tokens';
    }
    return { totalUsd: this.totalUsd, totalTokens: this.totalTokens, exceeded };
  }

  reading(): MeterReading {
    return { totalUsd: this.totalUsd, totalTokens: this.totalTokens, exceeded: null };
  }
}
