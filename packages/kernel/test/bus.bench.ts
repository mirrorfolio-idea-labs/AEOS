import { bench, describe } from 'vitest';
import { AeosEventSchema, newEventId, type AeosEvent } from '@aeos/contracts';
import { createEventBus } from '../src/index.js';

const SESSION = newEventId();

function msg(i: number): AeosEvent {
  return AeosEventSchema.parse({
    v: 1,
    id: newEventId(),
    ts: '2026-08-25T00:00:00.000Z',
    source: 'bench',
    agentId: 'bench-agent',
    sessionId: SESSION,
    type: 'item.message',
    payload: { role: 'assistant', text: `event ${i}` },
  });
}

const EVENTS: AeosEvent[] = Array.from({ length: 1_000 }, (_, i) => msg(i));

describe('kernel event bus', () => {
  bench(
    'publish + deliver 1,000 events to 3 subscribers',
    () => {
      const bus = createEventBus();
      let delivered = 0;
      bus.subscribe({}, () => delivered++);
      bus.subscribe({ typePrefix: 'item.' }, () => delivered++);
      bus.subscribe({ sessionId: SESSION }, () => delivered++);
      for (const event of EVENTS) bus.publish(event);
      if (delivered !== EVENTS.length * 3) throw new Error(`bus lost events: ${delivered}`);
    },
    { iterations: 10, warmupIterations: 2 },
  );
});

