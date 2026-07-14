import type { AeosEvent } from '@aeos/contracts';

/**
 * In-process typed pub/sub over the canonical event taxonomy (spec §6). The
 * contract is the envelope: a NATS/Redis transport can replace this without
 * consumer changes.
 */

export interface EventFilter {
  /** Match `event.type.startsWith(typePrefix)`, e.g. `'session.'`. */
  typePrefix?: string;
  agentId?: string;
  sessionId?: string;
}

export type EventHandler = (event: AeosEvent) => void;

export interface EventBusOptions {
  /**
   * Called when a subscriber throws. The canonical taxonomy is a closed
   * union, so handler failures surface through this callback rather than a
   * synthetic event type. Default: log to stderr — never silently swallowed.
   */
  onHandlerError?: (error: unknown, event: AeosEvent) => void;
}

export interface EventBus {
  publish(event: AeosEvent): void;
  /** Returns an unsubscribe function. */
  subscribe(filter: EventFilter, handler: EventHandler): () => void;
}

interface Subscriber {
  filter: EventFilter;
  handler: EventHandler;
}

function matches(filter: EventFilter, event: AeosEvent): boolean {
  if (filter.typePrefix !== undefined && !event.type.startsWith(filter.typePrefix)) return false;
  if (filter.agentId !== undefined && event.agentId !== filter.agentId) return false;
  if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false;
  return true;
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const onHandlerError =
    options.onHandlerError ??
    ((error: unknown, event: AeosEvent) => {
      console.error(`event-bus subscriber failed on ${event.type} (${event.id})`, error);
    });

  const subscribers = new Set<Subscriber>();
  const queue: AeosEvent[] = [];
  let draining = false;

  function drain(): void {
    if (draining) return; // publish() during a handler enqueues; outer loop delivers
    draining = true;
    try {
      for (let event = queue.shift(); event !== undefined; event = queue.shift()) {
        // snapshot: subscriptions changed by handlers apply from the next event on
        for (const sub of [...subscribers]) {
          if (!matches(sub.filter, event)) continue;
          try {
            sub.handler(event);
          } catch (error) {
            onHandlerError(error, event);
          }
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    publish(event: AeosEvent): void {
      queue.push(event);
      drain();
    },
    subscribe(filter: EventFilter, handler: EventHandler): () => void {
      const sub: Subscriber = { filter, handler };
      subscribers.add(sub);
      return () => subscribers.delete(sub);
    },
  };
}
