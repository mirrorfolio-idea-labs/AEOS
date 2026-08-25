import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Decrypter, Encrypter, generateIdentity, identityToRecipient } from 'age-encryption';

/** CRUD over an age-encrypted file store (spec §11). Values at rest only. */
export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string>;
  delete(ref: string): Promise<boolean>;
  list(): Promise<string[]>;
}

export class SecretNotFoundError extends Error {
  constructor(ref: string) {
    super(`secret "${ref}" is not in the store`);
    this.name = 'SecretNotFoundError';
  }
}

/** The store payload exists but cannot be opened with the available key material. */
export class SecretStoreLockedError extends Error {
  constructor(detail: string) {
    super(`secret store is unreadable: ${detail}`);
    this.name = 'SecretStoreLockedError';
  }
}

interface SecretMap {
  [ref: string]: string;
}

const IDENTITY_FILE = 'identity.key';
const STORE_FILE = 'store.age';

function secretsDir(home: string): string {
  return path.join(home, 'secrets');
}

async function ensureDir(dir: string, mode: number): Promise<void> {
  await mkdir(dir, { recursive: true, mode });
  await chmodIfSupported(dir, mode);
}

async function chmodIfSupported(target: string, mode: number): Promise<void> {
  try {
    const s = await stat(target);
    if ((s.mode & 0o777) !== mode) await import('node:fs/promises').then((fs) => fs.chmod(target, mode));
  } catch {
    // chmod is best-effort on platforms that don't support POSIX modes
  }
}

async function readIdentity(dir: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, IDENTITY_FILE), 'utf8');
  } catch {
    throw new SecretStoreLockedError(`no identity key at ${IDENTITY_FILE}`);
  }
  const identity = raw.trim();
  if (!identity.startsWith('AGE-SECRET-KEY-')) {
    throw new SecretStoreLockedError('identity key has an unexpected format');
  }
  return identity;
}

async function writePayload(dir: string, secrets: SecretMap): Promise<void> {
  const identity = await readIdentity(dir);
  const recipient = await identityToRecipient(identity).catch((e: unknown) => {
    throw new SecretStoreLockedError(`identity unusable (${String(e)})`);
  });
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  const bytes = await encrypter.encrypt(JSON.stringify(secrets));
  const target = path.join(dir, STORE_FILE);
  const tmp = path.join(dir, `${STORE_FILE}.tmp`);
  await writeFile(tmp, bytes, { mode: 0o600 });
  await chmodIfSupported(tmp, 0o600);
  await rename(tmp, target);
}

async function readPayload(dir: string): Promise<SecretMap> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path.join(dir, STORE_FILE)));
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return {};
    throw new SecretStoreLockedError(`payload unreadable (${String(e)})`);
  }
  const identity = await readIdentity(dir);
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  try {
    const text = await decrypter.decrypt(bytes, 'text');
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('payload is not a secret map');
    }
    const out: SecretMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch (e: unknown) {
    if (e instanceof SyntaxError) throw new SecretStoreLockedError('payload is corrupt');
    throw new SecretStoreLockedError(`decryption failed (${String(e)})`);
  }
}

/**
 * Age-encrypted file store under `<home>/secrets/` (spec §11): one X25519
 * identity (`identity.key`, 0600) plus the encrypted JSON map
 * (`store.age`, 0600), directory 0700. Every mutation rewrites the whole
 * payload atomically — v0 scale makes that cheap and keeps the format
 * dead-simple to back up and inspect.
 */
export function createFileSecretStore(home: string): SecretStore {
  const dir = secretsDir(home);

  async function ensureLayout(): Promise<void> {
    await ensureDir(dir, 0o700);
    const idPath = path.join(dir, IDENTITY_FILE);
    try {
      await stat(idPath);
    } catch {
      const identity = await generateIdentity();
      await writeFile(idPath, `${identity}\n`, { mode: 0o600 });
      await chmodIfSupported(idPath, 0o600);
    }
  }

  return {
    async set(ref, value): Promise<void> {
      await ensureLayout();
      const secrets = await readPayload(dir);
      secrets[ref] = value;
      await writePayload(dir, secrets);
    },
    async get(ref): Promise<string> {
      await ensureLayout();
      const secrets = await readPayload(dir);
      const value = secrets[ref];
      if (value === undefined) throw new SecretNotFoundError(ref);
      return value;
    },
    async delete(ref): Promise<boolean> {
      await ensureLayout();
      const secrets = await readPayload(dir);
      if (!(ref in secrets)) return false;
      delete secrets[ref];
      await writePayload(dir, secrets);
      return true;
    },
    async list(): Promise<string[]> {
      await ensureLayout();
      return Object.keys(await readPayload(dir));
    },
  };
}
