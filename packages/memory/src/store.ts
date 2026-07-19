import { readdir, readFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '@aeos/kernel';
import {
  ARCHIVE_DIR,
  MEMORY_DIRS,
  readIndex,
  writeIndex,
  type MemoryDir,
} from './layout.js';

export class OverBudgetError extends Error {
  constructor(
    readonly dir: string,
    readonly budget: number,
    readonly attempted: number,
  ) {
    super(
      `memory dir "${dir}" budget ${budget} chars would be exceeded (${attempted} attempted) — consolidate or archive first; nothing was written`,
    );
    this.name = 'OverBudgetError';
  }
}

export class UnknownMemoryDirError extends Error {
  constructor(dir: string) {
    super(`"${dir}" is not a memory directory (expected one of: ${MEMORY_DIRS.join(', ')})`);
    this.name = 'UnknownMemoryDirError';
  }
}

export interface WriteMemoryOptions {
  title: string;
  hook: string;
}

function splitRelPath(relPath: string): { dir: MemoryDir; file: string } {
  const [dir, ...rest] = relPath.split('/');
  if (!dir || rest.length === 0 || !(MEMORY_DIRS as readonly string[]).includes(dir)) {
    throw new UnknownMemoryDirError(dir ?? relPath);
  }
  return { dir: dir as MemoryDir, file: rest.join('/') };
}

/** Total chars currently stored in a memory dir (archive excluded). */
export async function dirUsage(root: string, dir: string, excludeFile?: string): Promise<number> {
  const abs = path.join(root, dir);
  let total = 0;
  let entries: string[];
  try {
    entries = await readdir(abs);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry === excludeFile) continue;
    try {
      total += (await readFile(path.join(abs, entry), 'utf8')).length;
    } catch {
      // subdirectories and unreadable entries don't count toward budget
    }
  }
  return total;
}

function indexLine(relPath: string, title: string, hook: string): string {
  return `- [${title}](${relPath}) — ${hook}`;
}

function withoutLineFor(lines: string[], relPath: string): string[] {
  return lines.filter((line) => !line.includes(`](${relPath})`));
}

/**
 * Budgeted memory write (spec §8 rule 1): if the directory's total would
 * exceed its declared budget the write fails with OverBudgetError and
 * NOTHING changes — no silent truncation. On success the MEMORY.md index
 * gains/updates this file's line.
 */
export async function writeMemoryFile(
  root: string,
  relPath: string,
  content: string,
  opts: WriteMemoryOptions,
): Promise<void> {
  const { dir } = splitRelPath(relPath);
  const index = await readIndex(root);
  const budget = index.budgets[dir];
  if (budget === undefined) throw new UnknownMemoryDirError(dir);
  const existing = await dirUsage(root, dir, path.basename(relPath));
  const attempted = existing + content.length;
  if (attempted > budget) throw new OverBudgetError(dir, budget, attempted);

  await writeFileAtomic(path.join(root, relPath), content);
  index.lines = [...withoutLineFor(index.lines, relPath), indexLine(relPath, opts.title, opts.hook)];
  await writeIndex(root, index);
}

/** Move a memory file under `.archive/<dir>/`, preserving content; never deletes. */
export async function archiveMemoryFile(root: string, relPath: string): Promise<string> {
  const { dir, file } = splitRelPath(relPath);
  const archiveRel = path.join(ARCHIVE_DIR, dir, file);
  await mkdir(path.join(root, ARCHIVE_DIR, dir), { recursive: true });
  await rename(path.join(root, relPath), path.join(root, archiveRel));
  const index = await readIndex(root);
  index.lines = withoutLineFor(index.lines, relPath);
  await writeIndex(root, index);
  return archiveRel;
}

/**
 * Replace several files in one dir with a single consolidated file. The
 * originals are archived (never deleted) first, so the budget check sees
 * only the new content plus untouched files.
 */
export async function consolidateMemoryFiles(
  root: string,
  relPaths: string[],
  targetRelPath: string,
  content: string,
  opts: WriteMemoryOptions,
): Promise<void> {
  const target = splitRelPath(targetRelPath);
  for (const relPath of relPaths) {
    const source = splitRelPath(relPath);
    if (source.dir !== target.dir) {
      throw new UnknownMemoryDirError(
        `consolidation must stay within one dir (got ${source.dir} and ${target.dir})`,
      );
    }
  }
  for (const relPath of relPaths) await archiveMemoryFile(root, relPath);
  await writeMemoryFile(root, targetRelPath, content, opts);
}
