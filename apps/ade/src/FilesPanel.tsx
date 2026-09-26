import { useEffect, useState } from 'react';
import type { AgentConfig } from '@aeos/contracts';
import type { MemoryProposalView, ObjectiveStatus } from '@aeos/sdk';
import { Button } from './components/ui/button.js';
import { client } from './api.js';
import { Badge } from './components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table.js';

interface FilesPanelProps {
  agent: AgentConfig;
  objectiveId: string;
}

interface MemoryIndex {
  budgets: Record<string, number>;
  lines: string[];
}

const statusVariant = (status: string) =>
  status === 'completed'
    ? 'success'
    : status === 'in_progress'
      ? 'warning'
      : status === 'blocked'
        ? 'destructive'
        : 'outline';

export function FilesPanel({ agent, objectiveId }: FilesPanelProps) {
  const [index, setIndex] = useState<MemoryIndex | null>(null);
  const [fileContent, setFileContent] = useState<{ path: string; content: string } | null>(null);
  const [plan, setPlan] = useState<ObjectiveStatus | null>(null);
  // P3.M4: retrospective / curator proposals awaiting the operator
  const [proposals, setProposals] = useState<MemoryProposalView[]>([]);
  const loadProposals = (): void => {
    void client
      .memoryProposals(agent.workspaceId, agent.id)
      .then(setProposals)
      .catch(() => setProposals([]));
  };
  const decide = async (id: string, accept: boolean): Promise<void> => {
    if (accept) await client.applyMemoryProposals(agent.workspaceId, agent.id, [id]);
    else await client.rejectMemoryProposal(agent.workspaceId, agent.id, id);
    loadProposals();
    const response = await fetch(`/v1/memory/index?workspaceId=${agent.workspaceId}&agentId=${agent.id}`);
    setIndex(((await response.json()) as { data: MemoryIndex | null }).data);
  };

  useEffect(loadProposals, [agent]);

  useEffect(() => {
    void fetch(`/v1/memory/index?workspaceId=${agent.workspaceId}&agentId=${agent.id}`)
      .then((r) => r.json())
      .then((envelope: { data: MemoryIndex | null }) => setIndex(envelope.data));
    if (!objectiveId) return;
    const load = (): void => {
      void client
        .objectiveStatus(agent.workspaceId, agent.id, objectiveId)
        .then(setPlan)
        .catch(() => setPlan(null));
    };
    load();
    // keep live while anything is in flight; stop once terminal
    const poll = setInterval(() => {
      let terminal = false;
      setPlan((current) => {
        terminal =
          current !== null &&
          !current.running &&
          current.tasks.every((t) => t.status === 'completed' || t.status === 'blocked');
        return current;
      });
      if (!terminal) load();
    }, 500);
    return () => clearInterval(poll);
  }, [agent, objectiveId]);

  const openFile = async (relPath: string) => {
    const response = await fetch(
      `/v1/memory/file?workspaceId=${agent.workspaceId}&agentId=${agent.id}&path=${encodeURIComponent(relPath)}`,
    );
    const envelope = (await response.json()) as { data: { path: string; content: string } | null };
    if (envelope.data) setFileContent(envelope.data);
  };

  const linkedPaths = (index?.lines ?? [])
    .map((line) => /\]\(([^)]+)\)/.exec(line)?.[1])
    .filter((p): p is string => p !== undefined);

  return (
    <div className="flex flex-col gap-4">
      {proposals.length > 0 && (
        <Card data-testid="memory-proposals">
          <CardHeader>
            <CardTitle>Proposed lessons &amp; preferences</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Learned from finished objectives. Accepted items reach the agent&apos;s next session.
            </p>
            {proposals.map((p) => (
              <div key={p.id} className="rounded-md border p-3" data-testid={`proposal-${p.id}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{p.path}</span>
                  <span className="flex gap-1.5">
                    <Button size="sm" onClick={() => void decide(p.id, true)} data-testid={`proposal-accept-${p.id}`}>
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void decide(p.id, false)}>
                      Reject
                    </Button>
                  </span>
                </div>
                {p.content !== undefined && (
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">{p.content}</pre>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Memory</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {index === null ? (
            <p className="text-sm text-muted-foreground">loading…</p>
          ) : linkedPaths.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="memory-empty">
              No memory files yet · budgets:{' '}
              {Object.entries(index.budgets)
                .slice(0, 3)
                .map(([dir, budget]) => `${dir} ${budget}`)
                .join(' · ')}{' '}
              …
            </p>
          ) : (
            <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {linkedPaths.map((relPath) => (
                <button
                  key={relPath}
                  onClick={() => void openFile(relPath)}
                  data-testid={`memory-${relPath}`}
                  className="rounded px-2 py-1 text-left font-mono text-xs hover:bg-secondary"
                >
                  {relPath}
                </button>
              ))}
            </div>
          )}
          {fileContent !== null && (
            <pre
              data-testid="memory-file-view"
              className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border bg-black/60 p-3 font-mono text-xs"
            >
              {fileContent.content}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan &amp; checkpoints{objectiveId ? ` — ${objectiveId}` : ''}</CardTitle>
        </CardHeader>
        <CardContent>
          {plan === null ? (
            <p className="text-sm text-muted-foreground">No objective loaded.</p>
          ) : (
            <Table data-testid="files-plan-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.tasks.map((task) => {
                  const checkpoint = plan.checkpoints.find((c) => c.taskId === task.id);
                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-mono">
                        {task.id} — {task.title}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(task.status)}>{task.status}</Badge>
                      </TableCell>
                      <TableCell>{checkpoint?.attempts ?? 0}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
