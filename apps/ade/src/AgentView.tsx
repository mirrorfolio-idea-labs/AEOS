import { useEffect, useRef, useState } from 'react';
import { FolderOpen, KeyRound, Play, ShieldCheck, TerminalSquare } from 'lucide-react';
import type { AeosEvent, AgentConfig } from '@aeos/contracts';
import type { ObjectiveStatus } from '@aeos/sdk';
import { client } from './api.js';
import { cn } from './lib/utils.js';
import { ApprovalsPanel } from './ApprovalsPanel.js';
import { Badge } from './components/ui/badge.js';
import { Button } from './components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card.js';
import { Input } from './components/ui/input.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table.js';
import { FilesPanel } from './FilesPanel.js';
import { TerminalPanel } from './TerminalPanel.js';

interface AgentViewProps {
  agent: AgentConfig;
  onChanged: () => Promise<void>;
}

const statusVariant = (status: string) =>
  status === 'completed'
    ? 'success'
    : status === 'in_progress'
      ? 'warning'
      : status === 'blocked'
        ? 'destructive'
        : 'outline';

export function AgentView({ agent, onChanged }: AgentViewProps) {
  const [objectiveId, setObjectiveId] = useState('');
  const [title, setTitle] = useState('');
  const [taskSpec, setTaskSpec] = useState('T1: do the work');
  const [status, setStatus] = useState<ObjectiveStatus | null>(null);
  const [events, setEvents] = useState<AeosEvent[]>([]);
  const [costUsd, setCostUsd] = useState(0);
  const [profileId, setProfileId] = useState(agent.credentialProfileId);
  const [switching, setSwitching] = useState(false);
  const [nextProfile, setNextProfile] = useState('');
  const consoleRef = useRef<HTMLDivElement>(null);
  const streaming = useRef(false);
  // live approvals badge (spec §11 notification hook v0): SSE-driven count
  const [pendingApprovals, setPendingApprovals] = useState(0);
  // P2.M5 human takeover: the latest live session, attachable via PTY
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    void client
      .listApprovals()
      .then((pending) => setPendingApprovals(pending.length))
      .catch(() => undefined);
  }, [agent.id]);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [events]);

  useEffect(() => {
    if (streaming.current) return;
    streaming.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of client.events({ signal: controller.signal })) {
          setEvents((previous) => [...previous.slice(-499), event]);
          if (event.type === 'cost.usage') {
            setCostUsd((previous) => previous + (event.payload as { usd: number }).usd);
          } else if (event.type === 'approval.request') {
            setPendingApprovals((previous) => previous + 1);
          } else if (event.type === 'approval.resolved') {
            setPendingApprovals((previous) => Math.max(0, previous - 1));
          } else if (event.type === 'session.created' && event.sessionId !== undefined) {
            setActiveSessionId(event.sessionId);
          } else if (
            (event.type === 'session.completed' ||
              event.type === 'session.failed' ||
              event.type === 'session.orphaned') &&
            event.sessionId !== undefined
          ) {
            setActiveSessionId((current) => (current === event.sessionId ? null : current));
          }
        }
      } catch {
        // stream closed
      }
    })();
    return () => controller.abort();
  }, []);

  const runObjective = async (event: React.FormEvent) => {
    event.preventDefault();
    const id = objectiveId || `obj-${Date.now().toString(36)}`;
    setObjectiveId(id);
    const tasks = taskSpec
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const colon = line.indexOf(':');
        return { id: line.slice(0, colon).trim(), title: line.slice(colon + 1).trim() };
      });
    await client.createObjective({
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      id,
      title: title || id,
      tasks,
    });
    await client.startObjective(agent.workspaceId, agent.id, id);
    const poll = setInterval(() => {
      void client
        .objectiveStatus(agent.workspaceId, agent.id, id)
        .then((next) => {
          setStatus(next);
          if (next.tasks.every((t) => t.status === 'completed' || t.status === 'blocked')) {
            clearInterval(poll);
          }
        })
        .catch(() => clearInterval(poll));
    }, 200);
  };

  const switchProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nextProfile) return;
    const updated = await client.switchCredentialProfile(agent.workspaceId, agent.id, nextProfile);
    setProfileId(updated.credentialProfileId);
    setSwitching(false);
    setNextProfile('');
    await onChanged();
  };

  const eventTone = (event: AeosEvent): string =>
    event.type === 'cost.usage'
      ? 'text-amber-400'
      : event.type === 'session.completed'
        ? 'text-emerald-400'
        : event.type === 'session.failed'
          ? 'text-red-400'
          : 'text-indigo-300';

  const refreshApprovalCount = (): void => {
    void client
      .listApprovals()
      .then((pending) => setPendingApprovals(pending.length))
      .catch(() => undefined);
  };

  return (
    <Tabs defaultValue="objective" className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {agent.name.slice(0, 2).toUpperCase()}
        </span>
        <strong>{agent.name}</strong>
        <span className="text-xs text-muted-foreground">
          {agent.workspaceId} · {agent.harness.provider}
        </span>
        <Badge data-testid="credential-profile">{profileId}</Badge>
        {switching ? (
          <form onSubmit={switchProfile} className="flex items-center gap-1.5">
            <Input
              autoFocus
              className="h-7 w-44"
              placeholder="credential profile id"
              value={nextProfile}
              onChange={(e) => setNextProfile(e.target.value)}
              data-testid="credential-input"
            />
            <Button type="submit" size="sm" data-testid="credential-apply">
              Apply
            </Button>
          </form>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSwitching(true)}
            data-testid="switch-credential"
          >
            <KeyRound className="h-3.5 w-3.5" /> Switch credentials
          </Button>
        )}
        <TabsList className="ml-auto">
          <TabsTrigger value="objective" data-testid="tab-objective">
            <TerminalSquare className="mr-1.5 h-3.5 w-3.5" /> Sessions
          </TabsTrigger>
          <TabsTrigger value="approvals" data-testid="tab-approvals" className="relative">
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Approvals
            {pendingApprovals > 0 && (
              <Badge variant="destructive" className="ml-1.5 px-1.5" data-testid="approvals-count">
                {pendingApprovals}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="files" data-testid="tab-files">
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" /> Access agent files
          </TabsTrigger>
          <TabsTrigger value="terminal" data-testid="tab-terminal">
            Takeover
          </TabsTrigger>
        </TabsList>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <TabsContent value="objective" className="mt-0 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>New objective</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={runObjective} className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-44"
                  placeholder="objective id (optional)"
                  value={objectiveId}
                  onChange={(e) => setObjectiveId(e.target.value)}
                  data-testid="objective-id"
                />
                <Input
                  className="w-52"
                  placeholder="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  data-testid="objective-title"
                />
                <Input
                  className="min-w-64 flex-1"
                  value={taskSpec}
                  onChange={(e) => setTaskSpec(e.target.value)}
                  data-testid="objective-tasks"
                />
                <Button type="submit" data-testid="run-objective">
                  <Play className="h-3.5 w-3.5" /> Run
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Plan</CardTitle>
              <span className="text-lg font-bold text-amber-400" data-testid="cost-meter">
                ${costUsd.toFixed(4)}
              </span>
            </CardHeader>
            <CardContent>
              {status === null ? (
                <p className="text-sm text-muted-foreground">Run an objective to see its plan.</p>
              ) : (
                <Table data-testid="plan-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.tasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell className="font-mono">{task.id}</TableCell>
                        <TableCell>{task.title}</TableCell>
                        <TableCell>
                          <Badge
                            variant={statusVariant(task.status)}
                            data-testid={`task-status-${task.id}`}
                          >
                            {task.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Live session console</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                ref={consoleRef}
                data-testid="console"
                className="h-64 overflow-y-auto whitespace-pre-wrap rounded-md border bg-black/60 p-3 font-mono text-xs leading-6"
              >
                {events.map((event) => (
                  <div key={event.id} className={cn(eventTone(event))}>
                    {event.ts.slice(11, 19)} {event.type}{' '}
                    {event.type === 'item.message'
                      ? (event.payload as { text: string }).text
                      : event.type === 'item.tool_call'
                        ? (event.payload as { tool: string }).tool
                        : event.type === 'cost.usage'
                          ? `$${(event.payload as { usd: number }).usd.toFixed(4)}`
                          : ''}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals" className="mt-0">
          <ApprovalsPanel onChanged={refreshApprovalCount} />
        </TabsContent>

        <TabsContent value="files" className="mt-0">
          <FilesPanel agent={agent} objectiveId={objectiveId} />
        </TabsContent>

        <TabsContent value="terminal" className="mt-0 h-full">
          {activeSessionId === null ? (
            <p className="p-4 text-sm text-muted-foreground" data-testid="terminal-empty">
              No live session to attach to. Takeover becomes available while an
              objective is running.
            </p>
          ) : (
            <TerminalPanel sessionId={activeSessionId} onReleased={() => setActiveSessionId(null)} />
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}
