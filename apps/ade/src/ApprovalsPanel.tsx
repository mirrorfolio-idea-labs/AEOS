import { useEffect, useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';
import type { PendingApproval } from '@aeos/sdk';
import { client } from './api.js';
import { Button } from './components/ui/button.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/ui/table.js';

/**
 * Approvals inbox (spec §11): pending confirm-tier requests, newest last.
 * Unanswered requests deny by daemon timeout — the buttons just answer
 * early. Empty state doubles as the "nothing needs you" signal.
 */
export function ApprovalsPanel({ onChanged }: { onChanged: () => void }) {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      setPending(await client.listApprovals());
    } catch {
      // daemon briefly unavailable mid-poll — next tick retries
    }
  };

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 500);
    return () => clearInterval(poll);
  }, []);

  const answer = async (requestId: string, decision: 'approve' | 'deny'): Promise<void> => {
    setBusy(requestId);
    try {
      await client.resolveApproval(requestId, decision);
      await refresh();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  if (pending.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="approvals-empty">
        No pending approvals.
      </p>
    );
  }

  return (
    <Table data-testid="approvals-table">
      <TableHeader>
        <TableRow>
          <TableHead>Tier</TableHead>
          <TableHead>Request</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead className="text-right">Decision</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pending.map((request) => (
          <TableRow key={request.requestId} data-testid="approvals-row">
            <TableCell>
              <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                {request.tier}
              </span>
            </TableCell>
            <TableCell className="max-w-96 truncate font-mono text-xs">{request.detail}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {new Date(request.expiresAt).toLocaleTimeString()}
            </TableCell>
            <TableCell className="space-x-1.5 text-right">
              <Button
                size="sm"
                variant="outline"
                disabled={busy === request.requestId}
                onClick={() => void answer(request.requestId, 'approve')}
                data-testid={`approval-approve-${request.tier}`}
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy === request.requestId}
                onClick={() => void answer(request.requestId, 'deny')}
                data-testid={`approval-deny-${request.tier}`}
              >
                <X className="h-3.5 w-3.5" /> Deny
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
