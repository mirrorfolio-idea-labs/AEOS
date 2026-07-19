import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { writeFileAtomic } from '@aeos/kernel';
import { z } from 'zod';

/** Spec §8 directory set. Order doubles as snapshot priority (T2). */
export const MEMORY_DIRS = [
  'identity',
  'preferences',
  'decisions',
  'lessons',
  'mistakes',
  'architecture',
  'roadmap',
  'experiments',
  'research',
  'knowledge',
  'skills',
  'meeting-notes',
  'documentation',
  'todos',
] as const;
export type MemoryDir = (typeof MEMORY_DIRS)[number];

export const ARCHIVE_DIR = '.archive';
export const PROPOSALS_DIR = '.proposals';

/** Default per-dir char budgets (spec §8 rule 1) — MEMORY.md frontmatter is truth. */
const DEFAULT_BUDGETS: Record<MemoryDir, number> = {
  identity: 4_000,
  preferences: 16_000,
  decisions: 16_000,
  lessons: 24_000,
  mistakes: 16_000,
  architecture: 24_000,
  roadmap: 16_000,
  experiments: 16_000,
  research: 32_000,
  knowledge: 32_000,
  skills: 16_000,
  'meeting-notes': 24_000,
  documentation: 32_000,
  todos: 8_000,
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

const IndexFileSchema = z.object({
  budgets: z.record(z.number().int().positive()),
});

export interface MemoryIndex {
  budgets: Record<string, number>;
  /** Raw index lines (everything after the frontmatter), one per memory file. */
  lines: string[];
}

export function memoryIndexPath(root: string): string {
  return path.join(root, 'MEMORY.md');
}

export function renderIndex(index: MemoryIndex): string {
  return (
    '---\n' +
    stringifyYaml({ budgets: index.budgets }).trimEnd() +
    '\n---\n\n# Memory index\n\n' +
    index.lines.join('\n') +
    (index.lines.length > 0 ? '\n' : '')
  );
}

export async function readIndex(root: string): Promise<MemoryIndex> {
  const raw = await readFile(memoryIndexPath(root), 'utf8');
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) throw new Error('MEMORY.md is missing its budgets frontmatter');
  const { budgets } = IndexFileSchema.parse(parseYaml(match[1] as string));
  const body = raw.slice(match[0].length);
  const lines = body.split('\n').filter((line) => line.startsWith('- ['));
  return { budgets, lines };
}

export async function writeIndex(root: string, index: MemoryIndex): Promise<void> {
  await writeFileAtomic(memoryIndexPath(root), renderIndex(index));
}

/** Create the full spec §8 layout with default budgets. Idempotent. */
export async function initMemoryLayout(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await Promise.all(
    [...MEMORY_DIRS, ARCHIVE_DIR, PROPOSALS_DIR].map((dir) =>
      mkdir(path.join(root, dir), { recursive: true }),
    ),
  );
  try {
    await readIndex(root);
  } catch {
    await writeIndex(root, { budgets: { ...DEFAULT_BUDGETS }, lines: [] });
  }
}
