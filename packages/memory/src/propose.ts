import { readdir, readFile, rm, readdir as readDir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { writeFileAtomic } from '@aeos/kernel';
import { z } from 'zod';
import { MEMORY_DIRS, PROPOSALS_DIR, readIndex, writeIndex } from './layout.js';
import { archiveMemoryFile, consolidateMemoryFiles, writeMemoryFile } from './store.js';

/**
 * `memory.propose` (spec §8 rule 2): mid-session learning never mutates
 * memory directly. Agents enqueue proposals as files; the daemon applies
 * them (policy-gated — the policy engine itself is P2) so they take effect
 * next session, keeping the in-session snapshot frozen.
 */
export const MemoryProposalSchema = z.discriminatedUnion('op', [
  z.object({
    id: z.string().min(1),
    op: z.literal('write'),
    path: z.string().min(1),
    content: z.string(),
    title: z.string().min(1),
    hook: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    op: z.literal('archive'),
    path: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    op: z.literal('consolidate'),
    paths: z.array(z.string().min(1)).min(1),
    path: z.string().min(1),
    content: z.string(),
    title: z.string().min(1),
    hook: z.string().min(1),
  }),
]);
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;

export interface ApplyResult {
  id: string;
  status: 'applied' | 'failed';
  error?: string;
}

const proposalPath = (root: string, id: string): string =>
  path.join(root, PROPOSALS_DIR, `${id}.yaml`);

export async function enqueueProposal(root: string, proposal: MemoryProposal): Promise<void> {
  MemoryProposalSchema.parse(proposal);
  await writeFileAtomic(proposalPath(root, proposal.id), stringifyYaml(proposal));
}

export async function listProposals(root: string): Promise<MemoryProposal[]> {
  let entries: string[];
  try {
    entries = (await readdir(path.join(root, PROPOSALS_DIR))).filter((e) => e.endsWith('.yaml')).sort();
  } catch {
    return [];
  }
  const proposals: MemoryProposal[] = [];
  for (const entry of entries) {
    const raw = await readFile(path.join(root, PROPOSALS_DIR, entry), 'utf8');
    proposals.push(MemoryProposalSchema.parse(parseYaml(raw)));
  }
  return proposals;
}

/**
 * Apply queued proposals in id order. Each proposal is atomic: it either
 * fully applies (and its queue file is removed) or fails (queue file stays,
 * error recorded in the result) — a failed proposal never half-writes
 * because the store ops themselves are atomic and budget-checked upfront.
 */
export async function applyProposals(root: string): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const proposal of await listProposals(root)) {
    try {
      if (proposal.op === 'write') {
        await writeMemoryFile(root, proposal.path, proposal.content, {
          title: proposal.title,
          hook: proposal.hook,
        });
      } else if (proposal.op === 'archive') {
        await archiveMemoryFile(root, proposal.path);
      } else {
        await consolidateMemoryFiles(root, proposal.paths, proposal.path, proposal.content, {
          title: proposal.title,
          hook: proposal.hook,
        });
      }
      await rm(proposalPath(root, proposal.id));
      results.push({ id: proposal.id, status: 'applied' });
    } catch (error: unknown) {
      results.push({
        id: proposal.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await syncIndex(root);
  return results;
}

/**
 * Regenerate MEMORY.md index lines from the on-disk file set: files without
 * a line get a placeholder entry; lines whose file vanished are dropped.
 * Guarantees the T3 accept — index lines always match the file set.
 */
export async function syncIndex(root: string): Promise<void> {
  const index = await readIndex(root);
  const onDisk = new Set<string>();
  for (const dir of MEMORY_DIRS) {
    try {
      for (const entry of await readDir(path.join(root, dir))) onDisk.add(`${dir}/${entry}`);
    } catch {
      // missing dirs contribute no files
    }
  }
  const linePathRe = /\]\(([^)]+)\)/;
  const kept = index.lines.filter((line) => {
    const match = linePathRe.exec(line);
    return match !== null && onDisk.has(match[1] as string);
  });
  const listed = new Set(
    kept.map((line) => (linePathRe.exec(line) as RegExpExecArray)[1] as string),
  );
  for (const relPath of [...onDisk].sort()) {
    if (!listed.has(relPath)) {
      kept.push(`- [${path.basename(relPath)}](${relPath}) — (unindexed; hook pending)`);
    }
  }
  index.lines = kept;
  await writeIndex(root, index);
}
