// Real production worker/resolver with isolated native host and pregranted local fixture permissions.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { startAdapterFixtureServer } from './server.mjs';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url)),
  { build } = require('esbuild');
const executable =
  process.env.NAV_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root = resolve('.fixture-adapters', 'installed-' + randomUUID()),
  extension = resolve(root, 'extension'),
  state = resolve(root, 'state'),
  output = resolve(root, 'output'),
  service = resolve(root,'downloader-service.exe'),
  cli = resolve(root,'downloader.exe');
await mkdir(root,{recursive:true});
await copyFile(resolve(process.env.NAV_NATIVE_BINARY ?? 'target/debug/downloader-service.exe'),service);
await copyFile(resolve(process.env.NAV_CLI_BINARY ?? 'target/debug/downloader.exe'),cli);
await mkdir(extension, { recursive: true });
await mkdir(state, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(root,'empty.js'),'// No renderer harness: installed production resolver only.');
const fixture = await startAdapterFixtureServer({port:0,harness:resolve(root,'empty.js')}),
  host = 'org.downloader.fixture_' + randomUUID().replaceAll('-', ''),
  env = { ...process.env, DOWNLOADER_DATA_DIR: state };
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }),
  key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
let extensionId = [
  ...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16),
]
  .map((n) => String.fromCharCode(97 + (n >> 4), 97 + (n & 15)))
  .join('');
await build({
  entryPoints: [
    'apps/extension/src/background.ts',
    'apps/extension/src/resolver.ts',
    'apps/extension/src/options.ts',
    'apps/extension/src/content.ts',
  ],
  outdir: extension,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: JSON.stringify('chromium') },
  plugins: [
    {
      name: 'fixture-native-address',
      setup(build) {
        build.onLoad({ filter: /background\.ts$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8')).replace(
            "const HOST = 'org.downloader.native';",
            "const HOST = '" + host + "';",
          ),
          loader: 'ts',
        }));
      },
    },
  ],
});
await copyFile('apps/extension/public/options.html', resolve(extension, 'options.html'));
await writeFile(
  resolve(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    key,
    name: 'Downloader production challenge fixture',
    version: '0.1.0',
    permissions: [
      'downloads',
      'nativeMessaging',
      'storage',
      'contextMenus',
      'activeTab',
      'alarms',
      'debugger',
      'cookies',
      'webRequest',
      'scripting',
      'tabs',
      'notifications',
    ],
    host_permissions: ['http://127.0.0.1/*'],
    background: { service_worker: 'background.js' },
    options_ui: { page: 'options.html', open_in_tab: true },
  }),
);
const manifest = resolve(root, 'native.json');
async function registration() {
  await writeFile(
    manifest,
    JSON.stringify({
      name: host,
      description: 'Isolated production challenge fixture',
      path: service,
      type: 'stdio',
      allowed_origins: ['chrome-extension://' + extensionId + '/'],
    }),
  );
  await writeFile(
    resolve(state, 'native-allowlist.json'),
    JSON.stringify({ chrome_ids: [extensionId], firefox_ids: [] }),
  );
}
await registration();
function call(...args) {
  return JSON.parse(
    execFileSync(cli, ['--json', ...args], {
      env,
      windowsHide: true,
      timeout: 60000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}
const daemon = spawn(service, ['daemon'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe'],
});
let daemonError = '';
daemon.stderr.on('data', (b) => (daemonError += b));
let settings;
for (let i = 0; i < 100; i++) {
  try {
    settings = call('settings').settings;
    break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
if (!settings) throw Error('Native startup failed:' + daemonError);
settings.directory = output;
settings.categories = [];
settings.captcha = {
  enabled: false,
  external_opt_in: false,
  key_ref: '',
  task_ceiling_microusd: 0,
  total_budget_microusd: 0,
};
await writeFile(resolve(root, 'settings.json'), JSON.stringify(settings));
call('set', resolve(root, 'settings.json'));
const registry =
  (/msedge/i.test(executable)
    ? 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\'
    : 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\') + host;
execFileSync('reg', ['ADD', registry, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'], {
  windowsHide: true,
  stdio: 'ignore',
});
let browserProc,
  ws,
  sequence = 0;
const pending = new Map();
function command(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + ' deadline'));
    }, 60000);
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer);
        resolveResult(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(session, expression) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let result;
    try {
      result = await command(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true, userGesture: true },
        session,
      );
    } catch (error) {
      if (String(error).includes('Execution context was destroyed') && attempt < 9) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw error;
    }
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  throw Error('Execution context recovery exhausted');
}
async function targetSession(targetId) {
  return (await command('Target.attachToTarget', { targetId, flatten: true })).sessionId;
}
async function click(session, name, role = 'button') {
  const tree = await command('Accessibility.getFullAXTree', {}, session),
    node = tree.nodes.find(
      (n) =>
        !n.ignored &&
        n.role?.value === role &&
        (name === null || n.name?.value === name) &&
        n.backendDOMNodeId,
    );
  if (!node) return false;
  const { model } = await command(
      'DOM.getBoxModel',
      { backendNodeId: node.backendDOMNodeId },
      session,
    ),
    border = model.border,
    x = (border[0] + border[2] + border[4] + border[6]) / 4,
    y = (border[1] + border[3] + border[5] + border[7]) / 4;
  await command(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x, y, button: 'left', clickCount: 1 },
    session,
  );
  await command(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 },
    session,
  );
  return true;
}
async function waitClick(session, name, role = 'button') {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await click(session, name, role)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(
    'Production control missing: ' +
      name +
      ' ' +
      JSON.stringify({
        tree: (await command('Accessibility.getFullAXTree', {}, session)).nodes
          .filter((n) => !n.ignored)
          .map((n) => ({ role: n.role?.value, name: n.name?.value })),
        jobs: call('list').jobs.map((j) => ({
          id: j.id,
          state: j.state,
          error: j.error,
          navigation_url: j.navigation_url,
          selected_host: j.selected_host,
        })),
        submits: fixture.submits,
      }),
  );
}
try {
  browserProc = spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
      '--user-data-dir=' + resolve(root, 'profile'),
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  browserProc.stderr.on('data', (b) => (stderr += b));
  let endpoint;
  for (let i = 0; i < 200; i++) {
    try {
      const lines = (await readFile(resolve(root, 'profile', 'DevToolsActivePort'), 'utf8'))
        .trim()
        .split(/\r?\n/);
      endpoint = 'ws://127.0.0.1:' + lines[0] + lines[1];
      break;
    } catch {}
    const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) {
      endpoint = match[1];
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!endpoint) throw Error('Browser startup failed:' + stderr);
  ws = new WebSocket(endpoint);
  await new Promise((r, reject) => {
    ws.onopen = r;
    ws.onerror = reject;
  });
  ws.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (!event.id) return;
    const waiter = pending.get(event.id);
    pending.delete(event.id);
    event.error ? waiter?.reject(Error(event.error.message)) : waiter?.resolve(event.result);
  };
  const version = await command('Browser.getVersion'),
    loaded = await command('Extensions.loadUnpacked', { path: extension });
  if (loaded.id && loaded.id !== extensionId) {
    extensionId = loaded.id;
    await registration();
  }
  const options = await command('Target.createTarget', {
      url: 'chrome-extension://' + extensionId + '/options.html',
    }),
    optionsSession = await targetSession(options.targetId);
  await evaluate(optionsSession, 'new Promise(r=>setTimeout(r,1000))');
  await evaluate(
    optionsSession,
    'chrome.storage.local.set({settings:{directCapture:true,locale:"en",disabledAdapters:[]}})',
  );
  await evaluate(optionsSession, 'chrome.runtime.sendMessage({type:"settings_changed"})');
  const rows = [];
  for (const scenario of [process.env.NAV_ADAPTER_CASE ?? 'disabled']) {
    const page = fixture.base + '/nav-adapters/g4u/ambiguous?case=' + scenario;
    const source={targetId:null};
    const job=call('add',page,'--navigate','--filename',scenario+'.bin');
    await evaluate(optionsSession,'chrome.runtime.sendMessage('+JSON.stringify({type:'continue_navigation',url:page})+')');
    let tab;
    for(let i=0;i<200;i++) {
      tab=(await command('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url===page&&t.targetId!==source.targetId);
      if(tab)break;
      if(i>0&&i%50===0)await evaluate(optionsSession,'chrome.runtime.sendMessage('+JSON.stringify({type:'continue_navigation',url:page})+')');
      await new Promise(r=>setTimeout(r,100));
    }
    assert(tab,'Owned resolver tab missing '+JSON.stringify({jobs:call('list').jobs,diagnostics:await evaluate(optionsSession,'chrome.runtime.sendMessage({type:"diagnostics"})'),snapshot:await evaluate(optionsSession,'chrome.runtime.sendMessage({type:"snapshot"})')}));
    await new Promise(r=>setTimeout(r,1000));
    for(let attempt=0;attempt<3;attempt++){try{await evaluate(optionsSession,'chrome.runtime.sendMessage('+JSON.stringify({type:'navigation_queue_continue',id:job.id})+')');break;}catch(error){if(!String(error).includes('changed during admission')||attempt===2)throw error;await new Promise(r=>setTimeout(r,300));}}
    const session=await targetSession(tab.targetId);
    await waitClick(session,null,'radio');
    if(scenario==='disabled') {
      await waitClick(session,'Use generic controls');
      await new Promise(r=>setTimeout(r,500));
      let stored;
      for(let i=0;i<100;i++){stored=await evaluate(optionsSession,'chrome.storage.local.get("settings")');if(stored.settings.disabledAdapters.includes('local-fixture'))break;await new Promise(r=>setTimeout(r,100));}
      assert(stored.settings.disabledAdapters.includes('local-fixture'),'Trusted disable did not persist '+JSON.stringify({stored,tree:(await command('Accessibility.getFullAXTree',{},session)).nodes.filter(n=>!n.ignored).map(n=>({role:n.role?.value,name:n.name?.value})),jobs:call('list').jobs}));
      let tree;
      for(let i=0;i<100;i++){tree=(await command('Accessibility.getFullAXTree',{},session)).nodes;if(tree.filter(n=>!n.ignored&&n.role?.value==='radio').length===2&&!tree.some(n=>!n.ignored&&n.name?.value==='Use generic controls'))break;await new Promise(r=>setTimeout(r,100));}
      assert(!tree.some(n=>!n.ignored&&n.name?.value==='Use generic controls'),'Fallback still uses local adapter');
      assert(tree.filter(n=>!n.ignored&&n.role?.value==='radio').length===2,'Generic fallback should preserve explicit ambiguity '+JSON.stringify({tree:tree.filter(n=>!n.ignored).map(n=>({role:n.role?.value,name:n.name?.value})),jobs:call('list').jobs.map(j=>({state:j.state,error:j.error,navigation_scope:j.navigation_scope,source_generation:j.source_generation})),diagnostics:await evaluate(optionsSession,'chrome.runtime.sendMessage({type:"diagnostics"})')}));
      await waitClick(session,'Cancel');
    } else {
      await evaluate(session,'document.querySelector("a[href]").setAttribute("href","/trap/purchase")');
      await waitClick(session,'Continue');
      let stale=false;
      for(let i=0;i<100;i++) {
        const tree=(await command('Accessibility.getFullAXTree',{},session)).nodes;
        stale=tree.some(n=>!n.ignored&&n.name?.value==='Page changed. Refresh the selection.');
        if(stale)break;
        await new Promise(r=>setTimeout(r,100));
      }
      assert(stale,'Stale selection was not refused');
    }
    await new Promise(r=>setTimeout(r,1000));
    const current=call('list').jobs.find(j=>j.id===job.id);
    assert(current.state!=='complete','Negative case published a file');
    assert.equal(fixture.requests.length,0,'Negative case issued a payload or purchase request');
    rows.push({scenario,state:current.state,unauthorized_requests:0,payload_requests:0,published:false});
    console.log('Verified '+scenario);
    // Entire isolated daemon/profile is disposed in finally; cancellation UI is not qualified here.
  }
  const sha=async(path)=>createHash('sha256').update(await readFile(path)).digest('hex');
  const sourceHashes={};for(const file of ['apps/extension/src/background.ts','apps/extension/src/resolver.ts','apps/extension/src/navigation/adapters/policy.ts','apps/extension/src/navigation/adapters/selection-ui.ts','apps/extension/src/navigation/adapters/preview.ts'])sourceHashes[file]=await sha(file);
  const bundleHashes={};for(const file of ['background.js','resolver.js','options.js','content.js'])bundleHashes[file]=await sha(resolve(extension,file));
  const evidence={checked_runtime_revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),native_build_revision:process.env.NAV_NATIVE_REVISION??null,cli_binary_sha256:await sha(cli),sourceHashes,bundleHashes,fixture:'production-installed-adapter-negatives-v1',browser:version.product,os:process.platform,arch:process.arch,native_version:call('diagnostics').version,native_binary_sha256:createHash('sha256').update(await readFile(service)).digest('hex'),rows,limits:['Synthetic loopback layouts; no live provider qualification','CLI creates the task; trusted production extension messages initiate owned navigation and resume completed HTML; desktop and context-menu UI activation are not qualified','Preview controls use actual AX/Input; no authorization shim and no payload bytes through CDP','Unique native fixture host and pregranted loopback permissions; production modules otherwise unchanged']};
  await writeFile(resolve(root,'evidence.json'),JSON.stringify(evidence,null,2));
  await mkdir('.local/nav-adapters',{recursive:true});
  await writeFile('.local/nav-adapters/installed-negatives-'+(/msedge/i.test(executable)?'edge':'chrome')+'-'+(process.env.NAV_ADAPTER_CASE??'disabled')+'-result.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));

} finally {
  if (ws) {
    await command('Browser.close').catch(() => {});
    ws.close();
  }
  browserProc?.kill();
  try {
    call('quit');
  } catch {}
  daemon.kill();
  await fixture.close();
  // Exactly the unique fixture-created key; no user native host registration is altered.
  execFileSync('reg', ['DELETE', registry, '/f'], { windowsHide: true, stdio: 'ignore' });
}
