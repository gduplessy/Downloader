import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

// Local review packaging; public release signing and provenance are separate gates.
const output = resolve('.local/review');
await mkdir(output, { recursive: true });
const installer = 'Downloader_0.1.0_x64-setup.exe';
await copyFile(
  join(
    process.env.DOWNLOADER_PACKAGE_TARGET || '.local/package-target',
    'debug/bundle/nsis',
    installer,
  ),
  join(output, installer),
);
for (const target of ['chromium', 'firefox']) {
  const dir = join('apps/extension/dist', target);
  const files = {};
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isFile()) files[item.name] = new Uint8Array(await readFile(join(dir, item.name)));
  }
  files['LICENSE'] = new Uint8Array(await readFile('LICENSE'));
  await writeFile(join(output, 'Downloader-extension-' + target + '.zip'), zipSync(files));
}
await copyFile('.local/evidence/desktop-window-only.png', join(output, 'desktop.png'));
for (const file of ['README.md', 'LICENSE', 'docs/ACCEPTANCE.md', 'docs/IMPLEMENTATION.md']) {
  await copyFile(file, join(output, file.split('/').at(-1)));
}
const hashes = [];
for (const file of (await readdir(output)).sort()) {
  if (file === 'SHA256SUMS') continue;
  const bytes = await readFile(join(output, file));
  hashes.push(createHash('sha256').update(bytes).digest('hex') + '  ' + file);
}
await writeFile(join(output, 'SHA256SUMS'), hashes.join('\n') + '\n');
console.log(output);
