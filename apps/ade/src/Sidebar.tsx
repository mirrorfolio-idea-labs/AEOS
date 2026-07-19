import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { AgentConfig, Workspace } from '@aeos/contracts';
import { client } from './api.js';
import { cn } from './lib/utils.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';

interface SidebarProps {
  workspaces: Workspace[];
  agents: Map<string, AgentConfig[]>;
  selected: AgentConfig | null;
  onSelect: (agent: AgentConfig) => void;
  onChanged: () => Promise<void>;
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function Sidebar({ workspaces, agents, selected, onSelect, onChanged }: SidebarProps) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentWorkspace, setAgentWorkspace] = useState('');

  const createWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspaceName) return;
    await client.createWorkspace({ id: slug(workspaceName), name: workspaceName });
    setWorkspaceName('');
    await onChanged();
  };

  const createAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    const workspaceId = agentWorkspace || workspaces[0]?.id;
    if (!agentName || workspaceId === undefined) return;
    await client.createAgent({
      id: slug(agentName),
      workspaceId,
      name: agentName,
      harness: {
        provider: 'claude-code',
        featureToggles: {
          plugins: false,
          skills: false,
          mcpServers: false,
          userClaudeMd: false,
          autoMemory: false,
        },
      },
      credentialProfileId: 'cp-default',
    });
    setAgentName('');
    await onChanged();
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-card p-4">
      <h1 className="text-lg font-bold tracking-[0.3em]">
        A<span className="text-primary">DE</span>
      </h1>

      {workspaces.map((workspace) => (
        <div key={workspace.id}>
          <div className="mb-1.5 rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {workspace.name}
          </div>
          {(agents.get(workspace.id) ?? []).map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelect(agent)}
              data-testid={`agent-${agent.id}`}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary',
                selected?.id === agent.id && selected.workspaceId === workspace.id && 'bg-accent',
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {agent.name.slice(0, 2).toUpperCase()}
              </span>
              {agent.name}
            </button>
          ))}
        </div>
      ))}

      <form onSubmit={createWorkspace} className="mt-auto flex flex-col gap-1.5">
        <Input
          placeholder="New workspace name"
          value={workspaceName}
          onChange={(e) => setWorkspaceName(e.target.value)}
          data-testid="workspace-name"
        />
        <Button type="submit" variant="secondary" size="sm" data-testid="create-workspace">
          <Plus className="h-3.5 w-3.5" /> Workspace
        </Button>
      </form>
      <form onSubmit={createAgent} className="flex flex-col gap-1.5">
        <Input
          placeholder="New agent name"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          data-testid="agent-name"
        />
        <select
          value={agentWorkspace}
          onChange={(e) => setAgentWorkspace(e.target.value)}
          data-testid="agent-workspace"
          className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground"
        >
          <option value="">(first workspace)</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" data-testid="create-agent">
          <Plus className="h-3.5 w-3.5" /> Agent
        </Button>
      </form>
    </aside>
  );
}
