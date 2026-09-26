import { useCallback, useEffect, useState } from 'react';
import { GitBranch, MessageSquarePlus, Send, X } from 'lucide-react';
import type { AgentConfig } from '@aeos/contracts';
import type { DiffScope, ObjectiveDiff, ReviewComment } from '@aeos/sdk';
import { client } from './api.js';
import { cn } from './lib/utils.js';
import { Badge } from './components/ui/badge.js';
import { Button } from './components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card.js';
import { Input } from './components/ui/input.js';

interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
  /** New-file line number (adds + context) — what a comment anchors to. */
  newLine?: number;
}

interface DiffFile {
  path: string;
  lines: DiffLine[];
}

/** Minimal unified-diff parser: enough to render and anchor line comments. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      current = { path: raw.split(' b/').at(-1) ?? raw, lines: [] };
      files.push(current);
      continue;
    }
    if (current === undefined) continue;
    if (raw.startsWith('+++ ') || raw.startsWith('--- ') || raw.startsWith('index ') || raw.startsWith('new file') || raw.startsWith('deleted file')) {
      continue;
    }
    if (raw.startsWith('@@')) {
      newLine = Number(/\+(\d+)/.exec(raw)?.[1] ?? '1');
      current.lines.push({ kind: 'hunk', text: raw });
    } else if (raw.startsWith('+')) {
      current.lines.push({ kind: 'add', text: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith('-')) {
      current.lines.push({ kind: 'del', text: raw.slice(1) });
    } else if (raw.startsWith(' ')) {
      current.lines.push({ kind: 'ctx', text: raw.slice(1), newLine: newLine++ });
    }
  }
  return files;
}

const SCOPES: Array<{ id: DiffScope; label: string }> = [
  { id: 'branch', label: 'Whole objective' },
  { id: 'last-commit', label: 'Last task' },
  { id: 'uncommitted', label: 'Uncommitted' },
];

interface ReviewPanelProps {
  agent: AgentConfig;
  objectiveId: string;
  onAgentChanged: () => Promise<void>;
}

/**
 * Review pane (herdr-reviewr idea, MIT, adapted): browse the objective
 * worktree diff by scope, click a line to leave a comment, then send the
 * batch back — the agent receives it as a new R<n> task.
 */
export function ReviewPanel({ agent, objectiveId, onAgentChanged }: ReviewPanelProps) {
  const [scope, setScope] = useState<DiffScope>('branch');
  const [diff, setDiff] = useState<ObjectiveDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [draftAt, setDraftAt] = useState<{ file?: string; line?: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [repoId, setRepoId] = useState('');
  const [repoPath, setRepoPath] = useState('');

  const load = useCallback(async () => {
    if (objectiveId === '') return;
    try {
      setDiff(await client.objectiveDiff(agent.workspaceId, agent.id, objectiveId, scope));
      setError(null);
    } catch (e) {
      setDiff(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [agent.workspaceId, agent.id, objectiveId, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const addComment = (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.trim() === '' || draftAt === null) return;
    setComments((previous) => [...previous, { ...draftAt, body: draft.trim() }]);
    setDraft('');
    setDraftAt(null);
  };

  const send = async () => {
    const result = await client.reviewObjective(agent.workspaceId, agent.id, objectiveId, comments);
    setComments([]);
    setSent(`Sent as task ${result.taskId} — the agent is on it.`);
  };

  const bind = async (event: React.FormEvent) => {
    event.preventDefault();
    await client.bindRepo(agent.workspaceId, agent.id, { id: repoId, path: repoPath });
    setRepoId('');
    setRepoPath('');
    await onAgentChanged();
  };

  const files = diff === null ? [] : parseUnifiedDiff(diff.diff);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Repositories</CardTitle>
          <div className="flex gap-1.5" data-testid="repo-list">
            {(agent.repos ?? []).map((repo) => (
              <Badge key={repo.id} variant="outline" title={repo.path}>
                <GitBranch className="mr-1 h-3 w-3" /> {repo.id}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={bind} className="flex flex-wrap items-center gap-2">
            <Input className="w-36" placeholder="repo id" value={repoId} onChange={(e) => setRepoId(e.target.value)} data-testid="repo-id" />
            <Input
              className="min-w-64 flex-1"
              placeholder="/absolute/path/to/checkout"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              data-testid="repo-path"
            />
            <Button type="submit" variant="outline" data-testid="repo-bind">
              Bind repo
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>
            Review {objectiveId === '' ? '' : <span className="font-mono text-sm text-muted-foreground">{objectiveId}</span>}
          </CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => void load()} data-testid="review-refresh">
              Refresh
            </Button>
            {SCOPES.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant={scope === s.id ? 'default' : 'outline'}
                onClick={() => setScope(s.id)}
                data-testid={`scope-${s.id}`}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {objectiveId === '' && <p className="text-sm text-muted-foreground">Run an objective with a repo to review its changes.</p>}
          {error !== null && objectiveId !== '' && (
            <p className="text-sm text-muted-foreground" data-testid="review-error">
              {error}
            </p>
          )}
          {diff !== null && (
            <p className="text-xs text-muted-foreground" data-testid="review-branch">
              {diff.branch} · {files.length} file{files.length === 1 ? '' : 's'} changed
            </p>
          )}
          {diff !== null && files.length === 0 && <p className="text-sm text-muted-foreground">No changes in this scope.</p>}
          {files.map((file) => (
            <div key={file.path} className="overflow-hidden rounded-md border" data-testid={`diff-file-${file.path}`}>
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 font-mono text-xs">
                {file.path}
                <Button size="sm" variant="ghost" onClick={() => setDraftAt({ file: file.path })} title="Comment on file">
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="font-mono text-xs leading-5">
                {file.lines.map((line, i) => (
                  <button
                    type="button"
                    key={i}
                    disabled={line.newLine === undefined}
                    onClick={() => line.newLine !== undefined && setDraftAt({ file: file.path, line: line.newLine })}
                    className={cn(
                      'flex w-full gap-3 px-3 text-left hover:bg-primary/10',
                      line.kind === 'add' && 'bg-emerald-500/10 text-emerald-300',
                      line.kind === 'del' && 'bg-red-500/10 text-red-300',
                      line.kind === 'hunk' && 'text-indigo-300',
                    )}
                    data-testid={line.newLine === undefined ? undefined : `diff-line-${file.path}-${String(line.newLine)}`}
                  >
                    <span className="w-8 shrink-0 text-right text-muted-foreground">{line.newLine ?? ''}</span>
                    <span className="whitespace-pre-wrap">
                      {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                      {line.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {objectiveId !== '' && (
            <Button variant="outline" size="sm" className="self-start" onClick={() => setDraftAt({})} data-testid="comment-general">
              <MessageSquarePlus className="h-3.5 w-3.5" /> General comment
            </Button>
          )}
          {draftAt !== null && (
            <form onSubmit={addComment} className="flex items-center gap-2" data-testid="comment-form">
              <Badge variant="outline" className="font-mono">
                {draftAt.file === undefined ? 'general' : `${draftAt.file}${draftAt.line === undefined ? '' : `:${String(draftAt.line)}`}`}
              </Badge>
              <Input autoFocus className="flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What should change?" data-testid="comment-input" />
              <Button type="submit" size="sm" data-testid="comment-add">
                Add
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraftAt(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </form>
          )}
          {comments.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-md border p-3" data-testid="pending-comments">
              {comments.map((c, i) => (
                <div key={i} className="text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.file === undefined ? 'general' : `${c.file}${c.line === undefined ? '' : `:${String(c.line)}`}`}
                  </span>{' '}
                  {c.body}
                </div>
              ))}
              <Button className="mt-1 self-start" onClick={() => void send()} data-testid="review-send">
                <Send className="h-3.5 w-3.5" /> Send {comments.length} to agent
              </Button>
            </div>
          )}
          {sent !== null && (
            <p className="text-sm text-emerald-400" data-testid="review-sent">
              {sent}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
