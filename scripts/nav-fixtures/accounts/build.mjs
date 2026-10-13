import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
await mkdir('.local/nav-accounts', { recursive: true });
await require('esbuild').build({
  entryPoints: ['scripts/nav-fixtures/accounts/harness.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: '.local/nav-accounts/account-harness.js',
});
