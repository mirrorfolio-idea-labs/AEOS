#!/usr/bin/env node
// create-aeos-plugin <dir> [--name <package-name>] [--id <provider-id>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'template');

export function scaffold(dir, { name, id } = {}) {
  const target = path.resolve(dir);
  const pkgName = name ?? path.basename(target);
  const providerId = id ?? (pkgName.replace(/^@[^/]+\//, '').replace(/^aeos-plugin-/, '').replace(/[^a-z0-9-]/g, '-') || 'example');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(providerId)) throw new Error(`invalid provider id "${providerId}" (lowercase letters, digits, dashes)`);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) throw new Error(`${target} exists and is not empty`);
  const tarball = `${pkgName.replace(/^@/, '').replace('/', '-')}-0.1.0.tgz`;
  const copy = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) copy(src, dst);
      else fs.writeFileSync(dst, fs.readFileSync(src, 'utf8').replaceAll('__NAME__', pkgName).replaceAll('__ID__', providerId).replaceAll('__TARBALL__', tarball));
    }
  };
  copy(TEMPLATE, target);
  return { dir: target, name: pkgName, id: providerId };
}

if (process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (f) => {
    const i = args.indexOf(`--${f}`);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const name = flag('name');
  const id = flag('id');
  const [dir] = args;
  if (dir === undefined) {
    console.error('usage: create-aeos-plugin <dir> [--name <package-name>] [--id <provider-id>]');
    process.exit(2);
  }
  try {
    const out = scaffold(dir, { name, id });
    console.log(`created ${out.name} in ${out.dir} — provider plugin:${out.id}\nnext: cd ${dir} && npm pack && aeos plugin install ./*.tgz`);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
