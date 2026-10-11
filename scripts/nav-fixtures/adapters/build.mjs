import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
await mkdir('.local/nav-adapters', { recursive: true });
await build({
  entryPoints: ['scripts/nav-fixtures/adapters/harness.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: '.local/nav-adapters/harness.js',
});
console.log('Built local adapter DOM harness');
