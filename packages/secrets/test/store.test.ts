import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SecretNotFoundError,
  SecretStoreLockedError,
  createFileSecretStore,
} from '../src/index.js';

const dirs: string[] = [];

async function tmpHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aeos-secrets-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('file secret store', () => {
  it('round-trips set/get/list/delete', async () => {
    const store = createFileSecretStore(await tmpHome());
    expect(await store.list()).toEqual([]);
    await store.set('openrouter_key', 'sk-or-test-value');
    expect(await store.get('openrouter_key')).toBe('sk-or-test-value');
    expect(await store.list()).toEqual(['openrouter_key']);
    await store.set('second_ref', 'v2');
    expect(await store.list().then((l) => [...l].sort())).toEqual(['openrouter_key', 'second_ref']);
    expect(await store.delete('openrouter_key')).toBe(true);
    expect(await store.delete('openrouter_key')).toBe(false);
    await expect(store.get('openrouter_key')).rejects.toBeInstanceOf(SecretNotFoundError);
    expect(await store.list()).toEqual(['second_ref']);
  });

  it('overwrites an existing ref without duplication', async () => {
    const store = createFileSecretStore(await tmpHome());
    await store.set('a', 'v1');
    await store.set('a', 'v2');
    expect(await store.get('a')).toBe('v2');
    expect(await store.list()).toEqual(['a']);
  });

  it('a second handle on the same home reads the stored values', async () => {
    const home = await tmpHome();
    const writer = createFileSecretStore(home);
    await writer.set('ref_a', 'value-a');
    const reader = createFileSecretStore(home);
    expect(await reader.get('ref_a')).toBe('value-a');
  });

  it('store.age copied without the identity key cannot be decrypted', async () => {
    const home = await tmpHome();
    const writer = createFileSecretStore(home);
    await writer.set('ref_a', 'value-a');

    const stolen = await tmpHome();
    await mkdir(path.join(stolen, 'secrets'), { recursive: true });
    await writeFile(
      path.join(stolen, 'secrets', 'store.age'),
      await readFile(path.join(home, 'secrets', 'store.age')),
    );
    const thief = createFileSecretStore(stolen);
    await expect(thief.get('ref_a')).rejects.toBeInstanceOf(SecretStoreLockedError);
    await expect(thief.list()).rejects.toBeInstanceOf(SecretStoreLockedError);
  });

  it('a tampered payload fails with a typed error, not garbage', async () => {
    const home = await tmpHome();
    const writer = createFileSecretStore(home);
    await writer.set('ref_a', 'value-a');
    const raw = await readFile(path.join(home, 'secrets', 'store.age'));
    raw[raw.length - 10] = raw[raw.length - 10]! ^ 0xff;
    await writeFile(path.join(home, 'secrets', 'store.age'), raw);
    const reader = createFileSecretStore(home);
    await expect(reader.get('ref_a')).rejects.toBeInstanceOf(SecretStoreLockedError);
  });

  it('permissions: secrets dir 0700, files 0600', async () => {
    const home = await tmpHome();
    const store = createFileSecretStore(home);
    await store.set('ref_a', 'value-a');
    const dirMode = (await stat(path.join(home, 'secrets'))).mode & 0o777;
    const idMode = (await stat(path.join(home, 'secrets', 'identity.key'))).mode & 0o777;
    const storeMode = (await stat(path.join(home, 'secrets', 'store.age'))).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(idMode).toBe(0o600);
    expect(storeMode).toBe(0o600);
  });

  it('the plaintext value never appears in any file under home', async () => {
    const home = await tmpHome();
    const store = createFileSecretStore(home);
    const value = 'CANARY-plaintext-secret-value';
    await store.set('canary_ref', value);

    async function* files(dir: string): AsyncGenerator<string> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* files(p);
        else yield p;
      }
    }
    for await (const file of files(home)) {
      const raw = await readFile(file);
      expect(raw.includes(value), `leaked into ${file}`).toBe(false);
    }
  });
});
