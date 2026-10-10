import { copyFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const target = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const profile = process.argv.includes('--debug') ? 'debug' : 'release';
const suffix = process.platform === 'win32' ? '.exe' : '';
await mkdir('apps/desktop/src-tauri/binaries', { recursive: true });
await copyFile(
  join(process.env.CARGO_TARGET_DIR || 'target', profile, 'downloader-service' + suffix),
  'apps/desktop/src-tauri/binaries/downloader-service-' + target + suffix,
);
console.log('Prepared ' + target + ' sidecar');
