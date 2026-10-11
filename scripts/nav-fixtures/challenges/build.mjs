import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url)),
  { build } = require('esbuild');
await mkdir('.local/nav-challenges', { recursive: true });
await build({
  entryPoints: ['scripts/nav-fixtures/challenges/harness.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: '.local/nav-challenges/harness.js',
});

await build({
  entryPoints: ['scripts/nav-fixtures/challenges/controls.tsx'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  nodePaths: [process.cwd() + '/apps/desktop/node_modules'],
  outfile: '.local/nav-challenges/controls.js',
});
