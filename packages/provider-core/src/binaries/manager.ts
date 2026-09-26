import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_PINS, tarballUrl, type BinaryPin, type ManagedHarness } from './pins.js';

export type BinaryErrorCode =
  | 'binary_unpinned'
  | 'binary_not_installed'
  | 'binary_integrity_mismatch'
  | 'binary_tampered'
  | 'binary_install_failed';

/** Typed failure from the binary manager — `code` is stable for API/CLI mapping. */
export class BinaryError extends Error {
  constructor(
    readonly code: BinaryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BinaryError';
  }
}

/** Written next to every verified install; the tree hash is what tamper checks compare. */
export interface InstallRecord {
  harness: ManagedHarness;
  version: string;
  integrity: string;
  treeSha256: string;
  installedAt: string;
}

export interface VerifiedBinary {
  harness: ManagedHarness;
  version: string;
  /** Absolute path of the pinned executable (`node_modules/.bin/<bin>`). */
  executable: string;
}

export interface BinaryManagerOptions {
  /** Root of managed installs, conventionally `<AEOS_HOME>/binaries`. */
  root: string;
  pins?: readonly BinaryPin[];
  /** Tarball fetch seam — tests inject bytes; default uses global `fetch`. */
  download?: (url: string) => Promise<Uint8Array>;
  /** Installs a verified tarball (and its platform deps) into `prefix`. */
  npmInstall?: (prefix: string, tarball: string) => Promise<void>;
  registry?: string;
}

export interface BinaryManager {
  pinFor(harness: ManagedHarness, version: string): BinaryPin;
  /** Download, integrity-check, install and seal one pinned release. Idempotent. */
  install(harness: ManagedHarness, version: string): Promise<VerifiedBinary>;
  /**
   * Re-hash an install against its seal; throws `binary_tampered` on any
   * drift. `fresh` bypasses the per-process cache (CLI `verify` uses it).
   */
  verify(harness: ManagedHarness, version: string, opts?: { fresh?: boolean }): VerifiedBinary;
  list(): InstallRecord[];
}

const RECORD = 'aeos-install.json';

const defaultDownload = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

const defaultNpmInstall = async (prefix: string, tarball: string): Promise<void> => {
  await promisify(execFile)(
    'npm',
    ['install', '--prefix', prefix, '--no-save', '--no-package-lock', '--no-audit', '--no-fund', tarball],
    { timeout: 10 * 60_000 },
  );
};

/** SRI (`sha512-<base64>`) check of raw bytes. */
export function matchesIntegrity(bytes: Uint8Array, integrity: string): boolean {
  const dash = integrity.indexOf('-');
  if (dash < 0) return false;
  const algorithm = integrity.slice(0, dash);
  if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) return false;
  return createHash(algorithm).update(bytes).digest('base64') === integrity.slice(dash + 1);
}

/**
 * Content hash of an install tree: every regular file's bytes and every
 * symlink's target, keyed by sorted relative path. `.bin` shims and npm's
 * own bookkeeping are excluded — they are regenerated, not payload.
 */
export function hashTree(dir: string): string {
  const entries: string[] = [];
  const walk = (current: string): void => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const rel = path.relative(dir, full);
      if (name === '.bin' || name === '.package-lock.json') continue;
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isSymbolicLink()) entries.push(`${rel}\0link:${fs.readlinkSync(full)}`);
      else if (stat.isFile()) {
        const digest = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        entries.push(`${rel}\0${stat.mode & 0o111 ? 'x' : '-'}${digest}`);
      }
    }
  };
  walk(dir);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

/**
 * Managed harness binaries (spec §9 Conductor pattern, P2.M7.T1): each
 * `(harness, version)` lives under `<root>/<harness>/<version>`, installed
 * only from a tarball whose bytes match the pin's integrity, then sealed
 * with a tree hash that every later `verify` recomputes. Verification is
 * cached per process by the executable's size+mtime so steady-state
 * spawns do not re-hash hundreds of megabytes.
 */
export function createBinaryManager(options: BinaryManagerOptions): BinaryManager {
  const pins = options.pins ?? DEFAULT_PINS;
  const download = options.download ?? defaultDownload;
  const npmInstall = options.npmInstall ?? defaultNpmInstall;
  const verified = new Map<string, string>();

  const dirFor = (harness: ManagedHarness, version: string): string =>
    path.join(options.root, harness, version);

  const pinFor = (harness: ManagedHarness, version: string): BinaryPin => {
    const pin = pins.find((p) => p.harness === harness && p.version === version);
    if (pin === undefined) {
      const known = pins.filter((p) => p.harness === harness).map((p) => p.version);
      throw new BinaryError(
        'binary_unpinned',
        `${harness}@${version} has no pin (known: ${known.join(', ') || 'none'})`,
      );
    }
    return pin;
  };

  const executableOf = (pin: BinaryPin, dir: string): string =>
    path.join(dir, 'node_modules', '.bin', pin.bin);

  const verify = (
    harness: ManagedHarness,
    version: string,
    opts: { fresh?: boolean } = {},
  ): VerifiedBinary => {
    const pin = pinFor(harness, version);
    const dir = dirFor(harness, version);
    const recordPath = path.join(dir, RECORD);
    if (!fs.existsSync(recordPath)) {
      throw new BinaryError(
        'binary_not_installed',
        `${harness}@${version} is pinned but not installed — run \`aeos harness install ${harness}@${version}\``,
      );
    }
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as InstallRecord;
    const executable = executableOf(pin, dir);
    let fingerprint: string;
    try {
      const stat = fs.statSync(executable);
      fingerprint = `${stat.size}:${stat.mtimeMs}:${record.treeSha256}`;
    } catch {
      throw new BinaryError('binary_tampered', `${harness}@${version}: executable ${executable} is missing`);
    }
    if (opts.fresh === true || verified.get(dir) !== fingerprint) {
      if (record.integrity !== pin.integrity || hashTree(path.join(dir, 'node_modules')) !== record.treeSha256) {
        verified.delete(dir);
        throw new BinaryError(
          'binary_tampered',
          `${harness}@${version} failed verification — install tree differs from its seal; reinstall it`,
        );
      }
      verified.set(dir, fingerprint);
    }
    return { harness, version, executable };
  };

  const install = async (harness: ManagedHarness, version: string): Promise<VerifiedBinary> => {
    const pin = pinFor(harness, version);
    const dir = dirFor(harness, version);
    if (fs.existsSync(path.join(dir, RECORD))) {
      try {
        return verify(harness, version);
      } catch (error) {
        if (!(error instanceof BinaryError) || error.code !== 'binary_tampered') throw error;
        fs.rmSync(dir, { recursive: true, force: true }); // reinstall over a broken seal
      }
    }
    const bytes = await download(tarballUrl(pin, options.registry));
    if (!matchesIntegrity(bytes, pin.integrity)) {
      throw new BinaryError(
        'binary_integrity_mismatch',
        `${pin.package}@${version} tarball does not match its pinned integrity — refusing to install`,
      );
    }
    const staging = `${dir}.partial`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const tarball = path.join(staging, 'package.tgz');
    fs.writeFileSync(tarball, bytes);
    try {
      await npmInstall(staging, tarball);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw new BinaryError('binary_install_failed', `npm install of ${pin.package}@${version} failed: ${String(error)}`);
    }
    fs.rmSync(tarball, { force: true });
    const record: InstallRecord = {
      harness,
      version,
      integrity: pin.integrity,
      treeSha256: hashTree(path.join(staging, 'node_modules')),
      installedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(staging, RECORD), JSON.stringify(record, null, 2) + '\n');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(staging, dir); // atomic publish: a crash leaves only `.partial`
    return verify(harness, version);
  };

  const list = (): InstallRecord[] => {
    const records: InstallRecord[] = [];
    if (!fs.existsSync(options.root)) return records;
    for (const harness of fs.readdirSync(options.root)) {
      const harnessDir = path.join(options.root, harness);
      if (!fs.statSync(harnessDir).isDirectory()) continue;
      for (const version of fs.readdirSync(harnessDir)) {
        const recordPath = path.join(harnessDir, version, RECORD);
        if (fs.existsSync(recordPath)) {
          records.push(JSON.parse(fs.readFileSync(recordPath, 'utf8')) as InstallRecord);
        }
      }
    }
    return records;
  };

  return { pinFor, install, verify, list };
}
