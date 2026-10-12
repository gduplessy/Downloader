import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url)),
  { build } = require('esbuild');
await mkdir('.local/nav-challenges', { recursive: true });
await build({
  entryPoints: ['scripts/nav-fixtures/challenges/benchmark.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.local/nav-challenges/benchmark.mjs',
});
const child = spawnSync(process.execPath, ['.local/nav-challenges/benchmark.mjs'], {
  windowsHide: true,
  stdio: 'inherit',
});
process.exit(child.status ?? 1);
