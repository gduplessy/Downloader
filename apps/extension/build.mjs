import { build } from 'esbuild';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { generateKeyPairSync, createHash } from 'node:crypto';
const { version } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
let key;
try {
  key = JSON.parse(await readFile('identity.json', 'utf8')).key;
} catch {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  await writeFile('identity.json', JSON.stringify({ key }, null, 2) + '\n');
}
const hash = createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
let id = '';
for (const n of hash) id += String.fromCharCode(97 + (n >> 4), 97 + (n & 15));
for (const target of ['chromium', 'firefox']) {
  const dir = 'dist/' + target;
  await mkdir(dir, { recursive: true });
  await build({
    entryPoints: [
      'src/background.ts',
      'src/content.ts',
      'src/popup.ts',
      'src/options.ts',
      'src/resolver.ts',
      'src/discovery.ts',
    ],
    outdir: dir,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    define: { BROWSER: JSON.stringify(target) },
    minify: false,
    sourcemap: true,
  });
  const common = {
    name: 'Downloader',
    version,
    description: 'Local, open-source download manager with reliable browser handoff.',
    permissions: ['downloads', 'nativeMessaging', 'storage', 'contextMenus', 'activeTab', 'alarms'],
    icons: { 32: 'icon32.png', 128: 'icon128.png' },
    options_ui: { page: 'options.html', open_in_tab: true },
    content_security_policy:
      target === 'chromium'
        ? { extension_pages: "script-src 'self'; object-src 'none'" }
        : "script-src 'self'; object-src 'none'",
  };
  const manifest =
    target === 'chromium'
      ? {
          ...common,
          manifest_version: 3,
          key,
          background: { service_worker: 'background.js' },
          action: { default_popup: 'popup.html' },
          optional_permissions: ['cookies', 'webRequest', 'scripting', 'tabs', 'notifications'],
          optional_host_permissions: ['http://*/*', 'https://*/*'],
        }
      : {
          ...common,
          manifest_version: 2,
          browser_specific_settings: {
            gecko: { id: 'downloader@opensource.local', strict_min_version: '115.0' },
          },
          background: { scripts: ['background.js'], persistent: false },
          browser_action: { default_popup: 'popup.html' },
          optional_permissions: ['cookies', 'webRequest', 'tabs', 'notifications', 'http://*/*', 'https://*/*'],
        };
  await copyFile('../desktop/src-tauri/icons/32x32.png', dir + '/icon32.png');
  await copyFile('../desktop/src-tauri/icons/128x128.png', dir + '/icon128.png');
  await writeFile(dir + '/manifest.json', JSON.stringify(manifest, null, 2));
  for (const name of ['popup.html', 'options.html', 'style.css', 'icon.svg'])
    await copyFile('public/' + name, dir + '/' + name);
}
await writeFile('dist/extension-id.txt', id + '\n');
console.log('Chromium extension ID: ' + id);
console.log('Register with: downloader register --chrome-id ' + id);
