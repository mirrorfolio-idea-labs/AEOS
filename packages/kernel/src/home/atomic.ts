import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Matches the `<name>.tmp.<random-hex>` suffix `writeFileAtomic` writes. */
const TMP_SUFFIX_PATTERN = /\.tmp\.[0-9a-f]+$/;

export interface WriteFileAtomicOptions {
  /**
   * Test seam only: invoked after the tmp file is written+fsynced but
   * before the rename. Throwing here simulates a crash between tmp-write
   * and rename (e.g. `kill -9`) without monkey-patching `fs` globally.
   */
  beforeRename?: () => void;
}

/**
 * Crash-safe file write (POSIX): write to `<path>.tmp.<random>` in the same
 * directory as `path`, fsync the tmp file's fd, rename it over `path`, then
 * fsync the parent directory's fd so the rename is durable too. If the
 * process dies before rename, `path` is left byte-identical to whatever it
 * was before the call (or absent), and the orphaned tmp file is detectable
 * via `isTmpFile` / removable via `cleanTmpFiles`.
 */
export function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  options: WriteFileAtomicOptions = {},
): void {
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp.${crypto.randomBytes(8).toString('hex')}`;

  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  options.beforeRename?.();

  fs.renameSync(tmpPath, filePath);
  fsyncDir(dir);
}

function fsyncDir(dir: string): void {
  const dirFd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
}

/** True for any file name matching the `*.tmp.*` pattern `writeFileAtomic` writes. */
export function isTmpFile(fileName: string): boolean {
  return TMP_SUFFIX_PATTERN.test(fileName);
}

/**
 * Removes orphaned tmp files (left behind by a crash between tmp-write and
 * rename) from `dir`. Only touches entries matching `isTmpFile`. Returns the
 * names removed.
 */
export function cleanTmpFiles(dir: string): string[] {
  const removed: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (isTmpFile(entry)) {
      fs.rmSync(path.join(dir, entry));
      removed.push(entry);
    }
  }
  return removed;
}
