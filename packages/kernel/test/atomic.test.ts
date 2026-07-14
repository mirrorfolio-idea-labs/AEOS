import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanTmpFiles, isTmpFile, writeFileAtomic } from '../src/home/atomic.js';

describe('writeFileAtomic', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-atomic-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the file and leaves no tmp file behind on success', () => {
    const target = path.join(dir, 'agent.yaml');
    writeFileAtomic(target, 'hello: world\n');

    expect(fs.readFileSync(target, 'utf8')).toBe('hello: world\n');
    const leftovers = fs.readdirSync(dir).filter((f) => f !== 'agent.yaml');
    expect(leftovers).toEqual([]);
  });

  it('overwrites an existing file atomically', () => {
    const target = path.join(dir, 'agent.yaml');
    writeFileAtomic(target, 'first\n');
    writeFileAtomic(target, 'second\n');

    expect(fs.readFileSync(target, 'utf8')).toBe('second\n');
    const leftovers = fs.readdirSync(dir).filter((f) => f !== 'agent.yaml');
    expect(leftovers).toEqual([]);
  });

  it('writes the tmp file in the same directory as the target, matching the tmp pattern', () => {
    const target = path.join(dir, 'agent.yaml');
    let seenDuringWrite: string[] = [];
    writeFileAtomic(target, 'hi\n', {
      beforeRename: () => {
        seenDuringWrite = fs.readdirSync(dir);
      },
    });
    expect(seenDuringWrite.length).toBe(1);
    expect(seenDuringWrite[0]).not.toBe('agent.yaml');
    expect(isTmpFile(seenDuringWrite[0]!)).toBe(true);
  });

  it('accepts Buffer payloads', () => {
    const target = path.join(dir, 'blob.bin');
    const payload = Buffer.from([0, 1, 2, 255]);
    writeFileAtomic(target, payload);
    expect(fs.readFileSync(target)).toEqual(payload);
  });
});

describe('isTmpFile', () => {
  it('matches the *.tmp.* pattern written by writeFileAtomic', () => {
    expect(isTmpFile('agent.yaml.tmp.abc123')).toBe(true);
    expect(isTmpFile('agent.yaml')).toBe(false);
    expect(isTmpFile('agent.yaml.tmpbackup')).toBe(false);
  });
});

describe('cleanTmpFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-clean-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes only files matching the tmp pattern, leaving real files intact', () => {
    fs.writeFileSync(path.join(dir, 'agent.yaml'), 'real\n');
    fs.writeFileSync(path.join(dir, 'agent.yaml.tmp.deadbeef'), 'orphan\n');
    fs.writeFileSync(path.join(dir, 'agent.yaml.tmp.cafef00d'), 'orphan2\n');

    const removed = cleanTmpFiles(dir);

    expect(removed.sort()).toEqual(['agent.yaml.tmp.cafef00d', 'agent.yaml.tmp.deadbeef']);
    expect(fs.readdirSync(dir)).toEqual(['agent.yaml']);
    expect(fs.readFileSync(path.join(dir, 'agent.yaml'), 'utf8')).toBe('real\n');
  });

  it('is a no-op on a directory with no tmp files', () => {
    fs.writeFileSync(path.join(dir, 'agent.yaml'), 'real\n');
    expect(cleanTmpFiles(dir)).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual(['agent.yaml']);
  });
});

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

/**
 * Exit-gate test (ROADMAP M2.T1 accept criterion): a `kill -9` between the
 * tmp write and the rename must never leave corrupt state. We simulate the
 * crash via the `beforeRename` test seam (no global `fs` monkey-patching)
 * and run write→crash→read 100x with randomized payload sizes and randomized
 * "did a prior file already exist" state.
 */
describe('crash-simulation: kill between tmp-write and rename (exit gate)', () => {
  it('never leaves corrupt state across 100 randomized write-crash-read cycles', () => {
    for (let i = 0; i < 100; i++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeos-crash-'));
      const target = path.join(dir, 'session.yaml');

      const hadPriorFile = Math.random() < 0.5;
      let priorContent: string | null = null;
      if (hadPriorFile) {
        priorContent = JSON.stringify({ iteration: i, tag: 'prior', pad: 'p'.repeat(randomInt(4000)) });
        fs.writeFileSync(target, priorContent);
      }

      const newPayload = JSON.stringify({
        iteration: i,
        tag: 'new',
        pad: 'x'.repeat(randomInt(20_000)),
      });

      let crashed = false;
      try {
        writeFileAtomic(target, newPayload, {
          beforeRename: () => {
            throw new Error('simulated kill -9');
          },
        });
      } catch (err) {
        crashed = true;
        expect((err as Error).message).toBe('simulated kill -9');
      }
      expect(crashed).toBe(true);

      // 1. Original file (if it existed) is byte-identical and parseable;
      //    a fresh read never sees partial/new content — rename never ran.
      if (priorContent !== null) {
        expect(fs.existsSync(target)).toBe(true);
        const readBack = fs.readFileSync(target, 'utf8');
        expect(readBack).toBe(priorContent);
        expect(() => JSON.parse(readBack)).not.toThrow();
        expect(JSON.parse(readBack).tag).toBe('prior');
      } else {
        expect(fs.existsSync(target)).toBe(false);
      }

      // 2. The orphaned tmp file is present and detectable.
      const entriesAfterCrash = fs.readdirSync(dir);
      const tmpEntries = entriesAfterCrash.filter((e) => isTmpFile(e));
      expect(tmpEntries.length).toBe(1);
      expect(entriesAfterCrash.length).toBe(hadPriorFile ? 2 : 1);

      // 3. cleanTmpFiles removes exactly the orphan, nothing else.
      const removed = cleanTmpFiles(dir);
      expect(removed).toEqual(tmpEntries);
      expect(fs.readdirSync(dir).some((e) => isTmpFile(e))).toBe(false);

      // 4. Final state matches pre-crash state exactly.
      if (priorContent !== null) {
        expect(fs.readdirSync(dir)).toEqual(['session.yaml']);
        expect(fs.readFileSync(target, 'utf8')).toBe(priorContent);
      } else {
        expect(fs.readdirSync(dir)).toEqual([]);
      }

      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
