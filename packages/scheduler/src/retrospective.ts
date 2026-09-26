import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { enqueueProposal, listProposals, type MemoryProposal } from '@aeos/memory';
import type { Checkpoint, PlanTask } from '@aeos/contracts';
import { readCheckpoints } from './checkpoint.js';
import { parsePlan } from './plan.js';

export interface RetrospectiveInput {
  objectiveDir: string;
  objectiveId: string;
  objectiveTitle: string;
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'x';

const firstMeaningfulLine = (output: string): string =>
  output
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('[aeos]'))
    ?.slice(0, 200) ?? '(no output)';

/** Review comments a human sent back (`tasks/R<n>.md`, P2.M9 review pane). */
async function reviewComments(objectiveDir: string): Promise<string[]> {
  let files: string[];
  try {
    files = (await readdir(path.join(objectiveDir, 'tasks'))).filter((f) => /^R\d+\.md$/.test(f)).sort();
  } catch {
    return [];
  }
  const comments: string[] = [];
  for (const file of files) {
    const text = await readFile(path.join(objectiveDir, 'tasks', file), 'utf8');
    for (const line of text.split('\n')) {
      const match = /^- (.+?): (.+)$/.exec(line.trim());
      if (match !== null) comments.push(`${(match[1] as string).replace(/`/g, '')}: ${match[2] as string}`);
    }
  }
  return comments;
}

/**
 * Post-objective retrospective (P3.M4.T1, spec §8.5): diff the plan
 * against what actually happened and turn the corrections into memory
 * proposals. Deterministic v0 (like the curator) — no model call, so the
 * same objective always yields the same proposals:
 *
 * - failed / flaky verification → a `lessons/` file naming the command,
 *   the task it caught and the first line of its output;
 * - tasks that needed re-dos → a `mistakes/` note;
 * - human review comments (R<n> tasks) → `preferences/` — they are the
 *   operator telling the agent how they want work done.
 *
 * Proposals go through `memory.propose` (never written directly), so they
 * only reach snapshots once accepted, and a re-run is idempotent: a
 * proposal id already queued is not queued twice.
 */
export async function runRetrospective(input: RetrospectiveInput, memoryRoot: string): Promise<MemoryProposal[]> {
  const plan = parsePlan(await readFile(path.join(input.objectiveDir, 'plan.md'), 'utf8'));
  const checkpoints = await readCheckpoints(input.objectiveDir);
  const byId = new Map<string, PlanTask>(plan.tasks.map((t) => [t.id, t]));
  const proposals: MemoryProposal[] = [];
  const base = `retro-${slug(input.objectiveId)}`;

  const verifyLines: string[] = [];
  const flakyLines: string[] = [];
  for (const checkpoint of checkpoints.values()) {
    const verification = checkpoint.verification;
    if (verification === undefined) continue;
    const task = byId.get(checkpoint.taskId);
    if (verification.outcome === 'flaky') {
      for (const c of verification.commands.filter((cmd) => cmd.attempts > 1 && cmd.exitCode === 0)) {
        flakyLines.push(`- \`${c.command}\` passed only on retry (${task?.title ?? checkpoint.taskId}).`);
      }
    }
    // attempts > 1 on a passing verify, or a failing/blocked one, means it caught broken work
    if (checkpoint.attempts > 1 || verification.outcome === 'fail') {
      const failing = verification.commands.find((c) => c.exitCode !== 0) ?? verification.commands.at(-1);
      verifyLines.push(
        `- \`${failing?.command ?? 'verification'}\` failed ${String(checkpoint.status === 'completed' ? checkpoint.attempts - 1 : checkpoint.attempts)}× on "${task?.title ?? checkpoint.taskId}"` +
          (failing !== undefined && failing.exitCode !== 0 ? ` — ${firstMeaningfulLine(failing.outputTail)}` : '') +
          '.',
      );
    }
  }
  if (verifyLines.length > 0 || flakyLines.length > 0) {
    const commands = [...new Set([...verifyLines, ...flakyLines].map((l) => /`([^`]+)`/.exec(l)?.[1]).filter(Boolean))];
    proposals.push({
      id: `${base}-verification`,
      op: 'write',
      path: `lessons/verification-${slug(input.objectiveId)}.md`,
      title: `Verification lessons from "${input.objectiveTitle}"`,
      hook: `run ${commands.map((c) => `\`${c as string}\``).join(', ')} before calling a code task done`,
      content: [
        `# Verification lessons — ${input.objectiveTitle}`,
        '',
        ...verifyLines,
        ...flakyLines,
        '',
        `Lesson: run ${commands.map((c) => `\`${c as string}\``).join(' and ')} yourself before finishing any code task in this repository.`,
        '',
      ].join('\n'),
    });
  }

  const redoLines = [...checkpoints.values()]
    .filter((c: Checkpoint) => c.verification === undefined && c.status === 'completed' && c.attempts > 1)
    .map((c) => `- "${byId.get(c.taskId)?.title ?? c.taskId}" took ${String(c.attempts)} attempts (${c.summary}).`);
  if (redoLines.length > 0) {
    proposals.push({
      id: `${base}-redos`,
      op: 'write',
      path: `mistakes/redos-${slug(input.objectiveId)}.md`,
      title: `Re-done tasks in "${input.objectiveTitle}"`,
      hook: 'tasks that failed before succeeding — check these areas carefully',
      content: [`# Re-done tasks — ${input.objectiveTitle}`, '', ...redoLines, ''].join('\n'),
    });
  }

  const comments = await reviewComments(input.objectiveDir);
  if (comments.length > 0) {
    proposals.push({
      id: `${base}-review-preferences`,
      op: 'write',
      path: `preferences/review-${slug(input.objectiveId)}.md`,
      title: `Reviewer preferences from "${input.objectiveTitle}"`,
      hook: 'how the operator wants work done — apply by default',
      content: [
        `# Reviewer preferences — ${input.objectiveTitle}`,
        '',
        'The operator corrected this work in review. Apply the same standard next time:',
        '',
        ...comments.map((c) => `- ${c}`),
        '',
      ].join('\n'),
    });
  }

  const queued = new Set((await listProposals(memoryRoot)).map((p) => p.id));
  for (const proposal of proposals) {
    if (!queued.has(proposal.id)) await enqueueProposal(memoryRoot, proposal);
  }
  return proposals;
}
