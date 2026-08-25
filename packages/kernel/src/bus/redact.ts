import type { AeosEvent } from '@aeos/contracts';
import type { EventBus, EventFilter, EventHandler } from './bus.js';

const MIN_REDACTION_LENGTH = 8;
const MARKER = '[REDACTED]';

function redactStrings(value: unknown, values: string[]): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const v of values) out = out.split(v).join(MARKER);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => redactStrings(item, values));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactStrings(v, values);
    return out;
  }
  return value;
}

/**
 * Wrap a bus so every published event is scrubbed before ANY subscriber
 * runs (spec §11): occurrences of registered secret values in string
 * fields become `[REDACTED]`. Because transcripts, audit files, SSE, and
 * REST views are all bus subscribers downstream of this point, one wrapper
 * covers every sink. The registry is re-queried per publish so newly
 * resolved secrets are covered immediately; values shorter than 8
 * characters are ignored to avoid mangling ordinary text.
 */
export function attachRedaction(bus: EventBus, getValues: () => Iterable<string>): EventBus {
  function scrub(event: AeosEvent): AeosEvent {
    const values = [...getValues()].filter((v) => v.length >= MIN_REDACTION_LENGTH);
    if (values.length === 0) return event;
    // the walk preserves the payload's shape; the union type just can't see it
    return {
      ...event,
      payload: redactStrings(event.payload, values),
    } as AeosEvent;
  }

  return {
    publish(event: AeosEvent): void {
      bus.publish(scrub(event));
    },
    subscribe(filter: EventFilter, handler: EventHandler): () => void {
      return bus.subscribe(filter, handler);
    },
  };
}
