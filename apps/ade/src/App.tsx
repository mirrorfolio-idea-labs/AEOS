import { useCallback, useEffect, useState } from 'react';
import type { AgentConfig, Workspace } from '@aeos/contracts';
import { client } from './api.js';
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

export function App() {
  const [deepLink] = useState(() => readDeepLink(window.location.search));
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentConfig[]>>(new Map());
  const [selected, setSelected] = useState<AgentConfig | null>(null);

  const refresh = useCallback(async () => {
    const list = await client.listWorkspaces();
    setWorkspaces(list);
    const byWorkspace = new Map<string, AgentConfig[]>();
    for (const workspace of list) {
      const response = await fetch(`/v1/agents?workspaceId=${workspace.id}`);
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
