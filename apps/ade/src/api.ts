import { AeosClient } from '@aeos/sdk';

/**
 * API bearer token for a remote daemon (P4.M3.T3). It is kept in
 * localStorage and can be handed over once through a `#token=` link, which
 * is stripped from the address bar immediately. A loopback daemon without a
 * token never needs one.
 */
const TOKEN_KEY = 'aeos.apiToken';

function readToken(): string | undefined {
  try {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (fromHash !== null && fromHash.length > 0) {
      window.localStorage.setItem(TOKEN_KEY, fromHash);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return fromHash;
    }
    return window.localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined; // storage blocked (private mode) — the gate asks per load
  }
}

let token = readToken();

export function saveToken(value: string | undefined): void {
  try {
    if (value === undefined) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, value);
  } catch {
    // ignore: the token still applies to this page load
  }
  token = value;
  client = makeClient();
}

const makeClient = (): AeosClient => new AeosClient({ baseUrl: '', ...(token === undefined ? {} : { token }) });

/** Same-origin client — the daemon (or the test harness) serves both UI and API. */
export let client = makeClient();

/** `fetch` for same-origin API paths, carrying the bearer token when one is set. */
export function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
  });
}
