// Test-only compatibility shim for gstack's older Windows Node server.
// Keeps its navigation restrictions and command handlers unchanged.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const upstream = process.env.GSTACK_BROWSE_ROOT;
if (!upstream) throw Error('Set GSTACK_BROWSE_ROOT to the installed gstack browse directory.');
const require = createRequire(join(upstream, 'package.json')),
  dir = resolve('.local/gstack-browser');
await mkdir(dir, { recursive: true });
let source = await readFile(join(upstream, 'dist/server-node.mjs'), 'utf8');
const start = source.indexOf('  async launch() {'),
  end = source.indexOf('  async close() {', start);
if (start < 0 || end < 0) throw Error('Unsupported gstack compatibility server');
source =
  source.slice(0, start) +
  [
    '  async launch() {',
    '    this.context = await chromium.launchPersistentContext(process.env.CHROMIUM_PROFILE, {',
    '      headless: false, viewport: {width:1280,height:800},',
    '      ignoreDefaultArgs: ["--disable-extensions","--enable-automation"],',
    '      args: ["--disable-extensions-except="+process.env.BROWSE_EXTENSIONS_DIR,"--load-extension="+process.env.BROWSE_EXTENSIONS_DIR]',
    '    });',
    '    this.browser=this.context.browser();this.isHeaded=true;',
    '    const adopt=page=>{const id=this.nextTabId++;this.pages.set(id,page);this.activeTabId=id;this.wirePageEvents(page);};',
    '    this.context.on("page",adopt);for(const page of this.context.pages())adopt(page);',
    '    if(!this.pages.size)await this.newTab();',
    '  }',
    '',
  ].join('\n') +
  source.slice(end);
source = source
  .replace(/from "([^"]+)"/g, (match, name) =>
    name.startsWith('node:') || name.startsWith('.') || require.resolve(name) === name
      ? match
      : 'from ' + JSON.stringify(pathToFileURL(require.resolve(name)).href),
  )
  .replace(
    /__require\("playwright"\)/g,
    '__require(' + JSON.stringify(require.resolve('playwright')) + ')',
  );
source = source.replace(
  /import \{ chromium \} from "[^"]+";/,
  'const {chromium}=__require(' + JSON.stringify(require.resolve('playwright')) + ');',
);
// Chrome's native permission modal blocks page JS; it must not trigger a
// health-check restart while a real consent dialog is being inspected.
const healthStart = source.indexOf('  async isHealthy() {'),
  healthEnd = source.indexOf('  async newTab(', healthStart);
if (healthStart < 0 || healthEnd < 0) throw Error('Unsupported gstack health implementation');
source =
  source.slice(0, healthStart) +
  '  async isHealthy() { return !!this.browser && this.browser.isConnected(); }\n' +
  source.slice(healthEnd);
await writeFile(join(dir, 'server-node.mjs'), source);
await copyFile(join(upstream, 'dist/bun-polyfill.cjs'), join(dir, 'bun-polyfill.cjs'));
console.log(join(dir, 'server-node.mjs'));
