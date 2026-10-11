// Keep product versions synchronized without changing wire/schema versions.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file), 'utf8');
const cargo = await read('Cargo.toml');
const pattern = /(\[workspace\.package\][\s\S]*?\bversion\s*=\s*")([^"]+)(")/;
const current = cargo.match(pattern)?.[2];
if (!current) throw Error('Workspace version missing');
const setting = process.argv[2] === '--set';
const version = setting ? process.argv[3] : current;
if (!/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? ''))
  throw Error('Use 0.MINOR.PATCH until the IDM parity release gate is satisfied');
const surfaces = new Map([['Cargo.toml', [cargo, pattern]]]);
for (const file of ['package.json', 'apps/desktop/package.json', 'apps/extension/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) {
  surfaces.set(file, [await read(file), /("version"\s*:\s*")([^"]+)(")/]);
}
for (const file of ['README.md', 'docs/ROADMAP.md']) {
  surfaces.set(file, [await read(file), /(<!-- product-version -->)([^<]+)(<!-- \/product-version -->)/]);
}
let lock = await read('Cargo.lock');
const packages = ['downloader-cli', 'downloader-core', 'downloader-desktop', 'downloader-service'];
for (const name of packages) {
  const re = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = ")([^"]+)(")`);
  const found = lock.match(re)?.[2];
  if (!found) throw Error(`Cargo.lock is missing ${name}`);
  if (!setting && found !== version) throw Error(`${name} lock version ${found} differs from ${version}`);
  lock = lock.replace(re, (_, a, _old, b) => a + version + b);
}
// Validate every surface before writing any of them.
for (const [file, [text, re]] of surfaces) {
  const found = text.match(re)?.[2];
  if (!found) throw Error(`Version missing in ${file}`);
  if (!setting && found !== version) throw Error(`${file} version ${found} differs from ${version}`);
}
if (setting) {
  for (const [file, [text, re]] of surfaces) {
    await writeFile(path.join(root, file), text.replace(re, (_, a, _old, b) => a + version + b));
  }
  await writeFile(path.join(root, 'Cargo.lock'), lock);
}
if (process.argv.includes('--artifacts')) {
  for (const browser of ['chromium', 'firefox']) {
    const file = `apps/extension/dist/${browser}/manifest.json`;
    if (JSON.parse(await read(file)).version !== version) throw Error(`${file} version differs from ${version}`);
  }
}
console.log(`Product version ${version}: ${setting ? 'updated' : 'synchronized'}`);
