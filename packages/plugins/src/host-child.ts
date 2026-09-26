/**
 * Plugin host child process (P4.M2.T2). Every plugin runs in its own
 * process: whatever it does (throw, hang, `process.exit`) it cannot take
 * the daemon down. It speaks a tiny JSON protocol over the fork IPC channel
 * — see host.ts for the parent side.
 *
 * Plugins never import AEOS at runtime: a provider emits `{ type, payload }`
 * and the HOST stamps the envelope (ULID, timestamp, session id, source) and
 * validates it against the contracts, so the daemon stays authoritative.
 *
 * `node host-child.js --translate <entry> <provider>` is a one-shot mode for
 * the synchronous, pure `translate()` (stdin raw JSON → stdout partials).
 */
import { pathToFileURL } from 'node:url';

interface PluginSession {
  events: AsyncIterable<unknown>;
  kill?: () => void;
  providerSessionId?: string;
  resumeToken?: string;
  costUsd?: number;
}
interface PluginProvider {
  capabilities(): unknown;
  createProfile(agent: unknown): unknown;
  spawn(opts: unknown): PluginSession;
  translate?(raw: unknown): unknown[];
}
type Factory = PluginProvider | (() => PluginProvider);

async function loadProviders(entry: string): Promise<Map<string, PluginProvider>> {
  const mod = (await import(pathToFileURL(entry).href)) as { default?: { providers?: Record<string, Factory> } };
  const providers = new Map<string, PluginProvider>();
  for (const [id, factory] of Object.entries(mod.default?.providers ?? {})) {
    providers.set(id, typeof factory === 'function' ? factory() : factory);
  }
  return providers;
}

const errorText = (error: unknown): string => (error instanceof Error ? `${error.message}` : String(error));

async function translateMode(entry: string, providerId: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const provider = (await loadProviders(entry)).get(providerId);
  if (provider?.translate === undefined) {
    process.stdout.write('[]');
    return;
  }
  const { raw } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { raw?: unknown };
  process.stdout.write(JSON.stringify(provider.translate(raw)));
}

async function serve(entry: string): Promise<void> {
  const send = (message: unknown): void => {
    process.send?.(message);
  };
  let providers: Map<string, PluginProvider>;
  try {
    providers = await loadProviders(entry);
  } catch (error) {
    send({ t: 'fatal', message: `plugin failed to load: ${errorText(error)}` });
    process.exit(1);
  }
  const sessions = new Map<string, PluginSession>();
  const provider = (id: unknown): PluginProvider => {
    const p = providers.get(String(id));
    if (p === undefined) throw new Error(`plugin has no provider "${String(id)}"`);
    return p;
  };

  process.on('message', (raw) => {
    const msg = raw as { t: string; id?: number; method?: string; provider?: string; stream?: string; agent?: unknown; opts?: unknown };
    if (msg.t === 'kill' && msg.stream !== undefined) {
      sessions.get(msg.stream)?.kill?.();
      return;
    }
    if (msg.t !== 'call') return;
    const reply = (result: unknown): void => send({ t: 'result', id: msg.id, result });
    const fail = (error: unknown): void => send({ t: 'error', id: msg.id, message: errorText(error) });
    void (async () => {
      try {
        if (msg.method === 'describe') {
          reply(Object.fromEntries([...providers].map(([id, p]) => [id, { capabilities: p.capabilities() }])));
        } else if (msg.method === 'createProfile') {
          reply(await provider(msg.provider).createProfile(msg.agent));
        } else if (msg.method === 'spawn' && msg.stream !== undefined) {
          const stream = msg.stream;
          const session = provider(msg.provider).spawn(msg.opts);
          sessions.set(stream, session);
          reply({ ok: true });
          try {
            for await (const event of session.events) send({ t: 'event', stream, event });
            send({
              t: 'end',
              stream,
              handle: { providerSessionId: session.providerSessionId, resumeToken: session.resumeToken, costUsd: session.costUsd },
            });
          } catch (error) {
            send({ t: 'end', stream, error: errorText(error) });
          } finally {
            sessions.delete(stream);
          }
        } else {
          fail(new Error(`unknown method ${String(msg.method)}`));
        }
      } catch (error) {
        fail(error);
      }
    })();
  });
  send({ t: 'ready' });
}

const [mode, a, b] = process.argv.slice(2);
if (mode === '--translate') {
  await translateMode(a as string, b as string);
} else {
  await serve(mode as string);
}
