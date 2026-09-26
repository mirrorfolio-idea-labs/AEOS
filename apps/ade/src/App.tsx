import { useCallback, useEffect, useState } from 'react';
import type { AgentConfig, Workspace } from '@aeos/contracts';
import { AeosApiError } from '@aeos/sdk';
import { apiFetch, client, saveToken } from './api.js';
import { Sidebar } from './Sidebar.js';
import { AgentView } from './AgentView.js';

/**
 * Deep-link view state (`?agent=<workspace>/<agent>&tab=<tab>`): the desktop
 * shell's notifications and `aeos://` links land here (P2.M8.T2) — no UI
 * logic lives in the shell itself.
 */
export function readDeepLink(search: string): { workspaceId: string; agentId: string; tab: string | undefined } | undefined {
  const params = new URLSearchParams(search);
  const agent = params.get('agent');
  const slash = agent?.indexOf('/') ?? -1;
  if (agent === null || slash <= 0) return undefined;
  return { workspaceId: agent.slice(0, slash), agentId: agent.slice(slash + 1), tab: params.get('tab') ?? undefined };
}

/**
 * Remote daemons require the API token (P4.M3.T3). Shown when the API
 * answers 401; the token is kept in this browser only.
 */
function TokenGate({ rejected }: { rejected: boolean }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex h-screen items-center justify-center p-6">
      <form
        aria-label="Sign in to AEOS"
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim().length === 0) return;
          saveToken(value.trim());
          window.location.reload();
        }}
      >
        <h1 className="text-lg font-semibold">Connect to this AEOS daemon</h1>
        <p className="text-sm text-muted-foreground">
          This daemon requires its API token (the value of <code>AEOS_API_TOKEN</code>). It is stored in this browser only.
        </p>
        {rejected ? <p className="text-sm text-destructive">That token was not accepted.</p> : null}
        <input
          aria-label="API token"
          type="password"
          autoComplete="current-password"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          Connect
        </button>
      </form>
    </div>
  );
}

const hadStoredToken = (): boolean => {
  try {
    return window.localStorage.getItem('aeos.apiToken') !== null;
  } catch {
    return false;
  }
};

export function App() {
  const [auth, setAuth] = useState<'ok' | 'needed' | 'rejected'>('ok');
  const [deepLink] = useState(() => readDeepLink(window.location.search));
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentConfig[]>>(new Map());
  const [selected, setSelected] = useState<AgentConfig | null>(null);

  const refresh = useCallback(async () => {
    let list: Workspace[];
    try {
      list = await client.listWorkspaces();
    } catch (error) {
      if (error instanceof AeosApiError && error.status === 401) {
        const hadToken = hadStoredToken();
        if (hadToken) saveToken(undefined); // a stale token: drop it, ask again
        setAuth(hadToken ? 'rejected' : 'needed');
        return;
      }
      throw error;
    }
    setWorkspaces(list);
    const byWorkspace = new Map<string, AgentConfig[]>();
    for (const workspace of list) {
      const response = await apiFetch(`/v1/agents?workspaceId=${workspace.id}`);
      const envelope = (await response.json()) as { data: AgentConfig[] | null };
      byWorkspace.set(workspace.id, envelope.data ?? []);
    }
    setAgents(byWorkspace);
    // keep the open agent in sync with the registry (e.g. a newly bound repo);
    // on first load, a deep link picks the agent
    setSelected((previous) =>
      previous === null
        ? deepLink === undefined
          ? null
          : (byWorkspace.get(deepLink.workspaceId)?.find((a) => a.id === deepLink.agentId) ?? null)
        : (byWorkspace.get(previous.workspaceId)?.find((a) => a.id === previous.id) ?? previous),
    );
  }, [deepLink]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (auth !== 'ok') return <TokenGate rejected={auth === 'rejected'} />;

  return (
    <div className="flex h-screen">
      <Sidebar
        workspaces={workspaces}
        agents={agents}
        selected={selected}
        onSelect={setSelected}
        onChanged={refresh}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        {selected === null ? (
          <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
            Create a workspace and an agent to begin — the agent, not the chat, is the durable
            object.
          </div>
        ) : (
          <AgentView
            key={`${selected.workspaceId}/${selected.id}`}
            agent={selected}
            onChanged={refresh}
            {...(deepLink?.agentId === selected.id && deepLink.tab !== undefined ? { initialTab: deepLink.tab } : {})}
          />
        )}
      </main>
    </div>
  );
}
