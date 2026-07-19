import { useEffect, useState } from 'react';
import type { AgentConfig } from '@aeos/contracts';
import type { ObjectiveStatus } from '@aeos/sdk';
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

  useEffect(() => {
    void fetch(`/v1/memory/index?workspaceId=${agent.workspaceId}&agentId=${agent.id}`)
      .then((r) => r.json())
      .then((envelope: { data: MemoryIndex | null }) => setIndex(envelope.data));
    if (objectiveId) {
      void client
        .objectiveStatus(agent.workspaceId, agent.id, objectiveId)
        .then(setPlan)
        .catch(() => setPlan(null));
    }
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
