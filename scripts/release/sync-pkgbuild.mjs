#!/usr/bin/env node
// Keeps packaging/arch/PKGBUILD on the product version (part of
// `pnpm changeset:version`, so the Version Packages PR carries it).
// pacman forbids '-' in pkgver: 1.0.0-rc.2 → pkgver=1.0.0rc2, _tag=v1.0.0-rc.2.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'aeosd', 'package.json'), 'utf8')).version;
const pkgver = version.replace(/-([a-z]+)\.(\d+)$/, '$1$2').replace(/-/g, '_');
const file = path.join(ROOT, 'packaging', 'arch', 'PKGBUILD');
const before = fs.readFileSync(file, 'utf8');
const after = before
  .replace(/^pkgver=.*$/m, `pkgver=${pkgver}`)
  .replace(/^_tag=.*$/m, `_tag=v${version}`)
  .replace(/^pkgrel=.*$/m, 'pkgrel=1');
if (after !== before) fs.writeFileSync(file, after);
console.log(`sync-pkgbuild: pkgver=${pkgver} _tag=v${version}`);
