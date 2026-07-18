/**
 * Fixed-capacity replay buffer (spec §10, Superset pattern): every appended
 * item gets a monotonically increasing seq; at capacity the oldest entry is
 * overwritten. `since(seq)` serves reconnecting daemons the retained tail —
 * anything older has already been made durable in the runner's local
 * transcript, so losing it from memory is safe.
 */

export interface RingEntry<T> {
  seq: number;
  item: T;
}

export class RingBuffer<T> {
  private readonly entries: RingEntry<T>[] = [];
  private seq = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`ring buffer capacity must be a positive integer, got ${capacity}`);
    }
  }

  get lastSeq(): number {
    return this.seq;
  }

  append(item: T): number {
    this.seq += 1;
    this.entries.push({ seq: this.seq, item });
    if (this.entries.length > this.capacity) this.entries.shift();
    return this.seq;
  }

  /** Retained entries with seq strictly greater than `fromSeq`, oldest first. */
  since(fromSeq: number): RingEntry<T>[] {
    return this.entries.filter((entry) => entry.seq > fromSeq);
  }
}
