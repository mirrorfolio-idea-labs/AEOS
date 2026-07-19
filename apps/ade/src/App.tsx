import { useCallback, useEffect, useState } from 'react';
import type { AgentConfig, Workspace } from '@aeos/contracts';
import { client } from './api.js';
import { Sidebar } from './Sidebar.js';
import { AgentView } from './AgentView.js';

export function App() {
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
  }, []);

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
          />
        )}
      </main>
    </div>
  );
}
