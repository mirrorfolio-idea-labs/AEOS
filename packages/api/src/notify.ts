import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { AgentStatusSchema } from '@aeos/contracts';
import type { AgentStatusEntry, AgentStatusTracker } from './status.js';

/**
 * `<AEOS_HOME>/notifications.yaml` — where attention changes get pushed.
 *
 * ```yaml
 * webhooks:
 *   - url: https://ntfy.sh/my-aeos-topic   # phone push via the ntfy app
 *     format: ntfy
 *   - url: https://hooks.slack.com/services/…
 *     format: slack
 *     on: [blocked]
 * ```
 */
export const NotificationsConfigSchema = z.object({
  webhooks: z
    .array(
      z.object({
        url: z.string().url(),
        format: z.enum(['json', 'ntfy', 'slack']).default('json'),
        on: z.array(AgentStatusSchema).default(['blocked', 'done']),
        /** Extra headers, e.g. `Authorization` for a private ntfy server. */
        headers: z.record(z.string()).default({}),
      }),
    )
    .default([]),
});
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;

export function loadNotificationsConfig(home: string): NotificationsConfig {
  const file = path.join(home, 'notifications.yaml');
  if (!fs.existsSync(file)) return { webhooks: [] };
  return NotificationsConfigSchema.parse(parseYaml(fs.readFileSync(file, 'utf8')) ?? {});
}

const headline = (entry: AgentStatusEntry): string =>
  entry.status === 'blocked'
    ? `${entry.agentId} needs you`
    : entry.status === 'done'
      ? `${entry.agentId} finished`
      : `${entry.agentId} is ${entry.status}`;

/** Render one status change for a webhook format. Pure — tested directly. */
export function renderNotification(
  format: 'json' | 'ntfy' | 'slack',
  entry: AgentStatusEntry,
): { body: string; headers: Record<string, string> } {
  const detail = entry.reason ?? entry.status;
  if (format === 'ntfy') {
    return {
      body: `${detail} (${entry.workspaceId}/${entry.agentId})`,
      headers: {
        Title: headline(entry),
        Tags: entry.status === 'blocked' ? 'warning' : 'white_check_mark',
        Priority: entry.status === 'blocked' ? 'high' : 'default',
      },
    };
  }
  if (format === 'slack') {
    return {
      body: JSON.stringify({ text: `*${headline(entry)}* — ${detail} (\`${entry.workspaceId}/${entry.agentId}\`)` }),
      headers: { 'content-type': 'application/json' },
    };
  }
  return {
    body: JSON.stringify({ event: 'agent.status_changed', ...entry }),
    headers: { 'content-type': 'application/json' },
  };
}

export interface NotifierOptions {
  home: string;
  tracker: AgentStatusTracker;
  fetchImpl?: typeof fetch;
  /** Failed deliveries are reported here; they never affect the agent. */
  onError?: (error: unknown, url: string) => void;
}

/**
 * Attention push (P2.M10.T4 — herdr-remote's idea of reaching the operator
 * on their phone, re-implemented as plain outbound webhooks). Config is
 * re-read per change, so editing notifications.yaml needs no restart.
 * Returns the unsubscribe function.
 */
export function attachNotifier(opts: NotifierOptions): () => void {
  const send = opts.fetchImpl ?? fetch;
  return opts.tracker.onChange((entry) => {
    let config: NotificationsConfig;
    try {
      config = loadNotificationsConfig(opts.home);
    } catch (error) {
      opts.onError?.(error, 'notifications.yaml');
      return;
    }
    for (const hook of config.webhooks) {
      if (!hook.on.includes(entry.status)) continue;
      const { body, headers } = renderNotification(hook.format, entry);
      void send(hook.url, { method: 'POST', body, headers: { ...headers, ...hook.headers } })
        .then((response) => {
          if (!response.ok) opts.onError?.(new Error(`HTTP ${String(response.status)}`), hook.url);
        })
        .catch((error: unknown) => opts.onError?.(error, hook.url));
    }
  });
}
