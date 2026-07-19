import { AeosClient } from '@aeos/sdk';

/** Same-origin client — the daemon (or the test harness) serves both UI and API. */
export const client = new AeosClient({ baseUrl: '' });
