// An AEOS provider plugin. AEOS loads this module in its own process (a
// crash here never takes the daemon down) and talks to it over IPC.
//
// The contract (AEOS plugin ABI ^1):
// - `capabilities()` must describe what the provider really does; the
//   conformance suite checks the claims.
// - `createProfile(agent)` returns `{ rootDir, env, argv }`. It must be
//   hermetic: no `$HOME` or `~/` references.
// - `spawn(opts)` returns `{ events, kill(), providerSessionId? }`.
//   `events` yields `{ type, payload }` objects from the AEOS event
//   taxonomy. AEOS stamps ids, timestamps and the session id itself, and
//   rejects anything outside the contract. The first event must be
//   `session.created`; the last must be `session.completed` or
//   `session.failed`.
// - `translate(raw)` is pure: the same input always gives the same
//   partial events.
//
// No runtime dependency on AEOS is needed, so this file is plain JS.
import os from 'node:os';
import path from 'node:path';

const PROVIDER_ID = '__ID__';

function createProvider() {
  return {
    capabilities() {
      return { resume: false, structuredOutput: true, mcp: false, sandbox: false, costReporting: true, costUsd: true };
    },

    createProfile(agent) {
      // provider state lives in a directory you own; never the user's home
      return { rootDir: path.join(os.tmpdir(), `aeos-${PROVIDER_ID}`, agent.id), env: {}, argv: [] };
    },

    spawn(opts) {
      let killed = false;
      const session = {
        providerSessionId: `${PROVIDER_ID}-${opts.sessionId}`,
        kill() {
          killed = true;
        },
        events: (async function* () {
          const steps = [
            { type: 'session.created', payload: {} },
            { type: 'turn.started', payload: { turn: 1 } },
            { type: 'item.message', payload: { role: 'assistant', text: `echo: ${opts.objective}` } },
            { type: 'turn.completed', payload: { turn: 1 } },
            {
              type: 'cost.usage',
              payload: { profileId: PROVIDER_ID, usd: 0, inputTokens: opts.objective.length, outputTokens: opts.objective.length + 6 },
            },
            { type: 'session.completed', payload: {} },
          ];
          for (const step of steps) {
            await new Promise((resolve) => setTimeout(resolve, 5));
            if (killed) return;
            yield step;
          }
        })(),
      };
      return session;
    },

    translate(raw) {
      if (raw === null || typeof raw !== 'object' || typeof raw.text !== 'string') return [];
      return [{ type: 'item.message', payload: { role: 'assistant', text: raw.text } }];
    },
  };
}

export default { providers: { [PROVIDER_ID]: createProvider } };
