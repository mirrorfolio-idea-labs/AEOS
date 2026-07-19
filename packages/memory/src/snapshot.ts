import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { MEMORY_DIRS, readIndex, renderIndex } from './layout.js';

export interface ComposeSnapshotOptions {
  /** Hard cap on snapshot size — files that don't fit are skipped whole. */
  charBudget: number;
  /**
   * Optional relevance terms. Files whose path or content match more terms
   * sort earlier WITHIN their directory; priority across directories is
   * fixed (identity first). Deterministic: ties break on path.
   */
  relevance?: readonly string[];
}

export interface MemorySnapshot {
  /** The frozen injection payload (spec §8 rule 2). */
  text: string;
  includedFiles: string[];
  skippedFiles: string[];
  totalChars: number;
}

interface Candidate {
  relPath: string;
  content: string;
  score: number;
}

function relevanceScore(candidate: { relPath: string; content: string }, terms: readonly string[]): number {
  let score = 0;
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (candidate.relPath.toLowerCase().includes(needle)) score += 2;
    if (candidate.content.toLowerCase().includes(needle)) score += 1;
  }
  return score;
}

/**
 * Compose the frozen session snapshot: MEMORY.md index first, then whole
 * files in deterministic priority order until the budget is filled. Same
 * inputs → byte-identical output (no timestamps, no randomness), which is
 * what keeps provider prompt caches stable across sessions (spec §8).
 */
export async function composeSnapshot(
  root: string,
  opts: ComposeSnapshotOptions,
): Promise<MemorySnapshot> {
  const index = await readIndex(root);
  const header = `# Agent memory snapshot\n\n${renderIndex(index)}\n`;

  const includedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let text = header;

  for (const dir of MEMORY_DIRS) {
    let entries: string[];
    try {
      entries = (await readdir(path.join(root, dir))).sort();
    } catch {
      continue;
    }
    const candidates: Candidate[] = [];
    for (const entry of entries) {
      const relPath = `${dir}/${entry}`;
      try {
        const content = await readFile(path.join(root, relPath), 'utf8');
        candidates.push({
          relPath,
          content,
          score: opts.relevance ? relevanceScore({ relPath, content }, opts.relevance) : 0,
        });
      } catch {
        // subdirectories are not snapshot candidates in v0
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));
    for (const candidate of candidates) {
      const block = `\n---\n<!-- memory:${candidate.relPath} -->\n${candidate.content}\n`;
      if (text.length + block.length > opts.charBudget) {
        skippedFiles.push(candidate.relPath);
        continue;
      }
      text += block;
      includedFiles.push(candidate.relPath);
    }
  }

  return { text, includedFiles, skippedFiles, totalChars: text.length };
}
