import { createServer } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
const executable =
  process.env.NAV_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = resolve('.local/nav-discovery', 'extension-' + Date.now());
const ext = resolve(dir, 'extension');
const data = resolve(dir, 'service');
await mkdir(ext, { recursive: true });
await mkdir(data, { recursive: true });
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
let extId = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)]
  .map((n) => String.fromCharCode(97 + (n >> 4), 97 + (n & 15)))
  .join('');
const host = 'org.downloader.fixture_' + crypto.randomUUID().replaceAll('-', '');
const nativeBinary = resolve('target/debug/downloader-service.exe');
const cli = resolve('target/debug/downloader.exe');
const nativeManifest = resolve(dir, 'native.json');
await writeFile(
  nativeManifest,
  JSON.stringify({
    name: host,
    description: 'Isolated Downloader stream fixture',
    path: nativeBinary,
    type: 'stdio',
    allowed_origins: ['chrome-extension://' + extId + '/'],
  }),
);
await writeFile(
  resolve(data, 'native-allowlist.json'),
  JSON.stringify({ chrome_ids: [extId], firefox_ids: [] }),
);
await cp(resolve('apps/extension/dist/chromium'), ext, { recursive: true });

const background = await readFile('apps/extension/src/background.ts', 'utf8');
await build({
  stdin: {
    contents:
      background +
      `
(globalThis).fixture={native,discovery,browserSnapshot,pollResolvers,resolverContext,profile,async setup(base,id){await browser.storage.local.set({settings:{...defaults,directCapture:true}});await load();const tab=await browser.tabs.create({url:base+'/login',active:false});while((await browser.tabs.get(tab.id)).status!=='complete')await new Promise(r=>setTimeout(r,50));await browser.tabs.update(tab.id,{url:base+'/nav-adapters/gofile/rendered'});while((await browser.tabs.get(tab.id)).status!=='complete')await new Promise(r=>setTimeout(r,50));await discovery.start(id,tab.id,[]);return tab.id;}};`,
    resolveDir: resolve('apps/extension/src'),
    sourcefile: 'fixture-background.ts',
    loader: 'ts',
  },
  outfile: resolve(ext, 'background.js'),
  nodePaths: [resolve('apps/extension/node_modules')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: '"chromium"' },
  plugins: [
    {
      name: 'isolated-native-host',
      setup(api) {
        api.onLoad({ filter: /transport\.ts$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8')).replaceAll('org.downloader.native', host),
          loader: 'ts',
        }));
      },
    },
  ],
});
let bundle = await readFile(resolve(ext, 'background.js'), 'utf8');
await writeFile(resolve(ext, 'background.js'), bundle.replaceAll('org.downloader.native', host));
await writeFile(resolve(ext, 'fixture.html'), '<script src="wake.js"></script>');
await writeFile(
  resolve(ext, 'wake.js'),
  'setInterval(()=>chrome.runtime.sendMessage({type:"fixture_ping"}).catch(()=>{}),500)',
);
const manifest = JSON.parse(await readFile(resolve(ext, 'manifest.json'), 'utf8'));
Object.assign(manifest, {
  key,
  permissions: [
    ...new Set([
      ...manifest.permissions,
      'debugger',
      'nativeMessaging',
      'cookies',
      'tabs',
      'scripting',
      'storage',
      'webRequest',
    ]),
  ],
  host_permissions: ['http://127.0.0.1/*'],
});
await writeFile(resolve(ext, 'manifest.json'), JSON.stringify(manifest));
const payload = Buffer.alloc(Number(process.env.NAV_BYTES ?? 256 * 1024 + 17));
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) % 251;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requests = [];
let consumed = false;
let pageRequests = 0;
const server = createServer((req, res) => {
  if (req.url === '/login') {
    res.setHeader('Set-Cookie', 'fixture_auth=1; Path=/; SameSite=Lax');
    res.setHeader('Content-Type', 'text/html');
    res.end('<p>Permitted local authenticated fixture</p>');
    return;
  }
  if (req.url === '/nav-adapters/gofile/rendered') {
    pageRequests++;
    res.setHeader('Content-Type', 'text/html');
    if (!req.headers.cookie?.includes('fixture_auth=1')) {
      res.end('<input type="password">');
      return;
    }
    res.end(
      '<!doctype html><meta charset="utf-8"><title>Rendered discovery fixture</title><div aria-busy="true" id="loading">Loading</div><script>setTimeout(()=>{const a=document.createElement("a");a.href="/nav-adapters/gofile/authenticated.bin";a.textContent="T\u00e9l\u00e9charger";document.body.append(a);document.querySelector("#loading").remove();const loop=document.createElement("a");loop.href="/nav-adapters/gofile/rendered#loop";loop.textContent="Loop";document.body.append(loop)},900)</script>',
    );
    return;
  }
  if (req.url === '/nav-adapters/gofile/authenticated.bin') {
    requests.push({
      method: req.method,
      authenticated: !!req.headers.cookie?.includes('fixture_auth=1'),
    });
    if (consumed || req.method !== 'GET' || !requests.at(-1).authenticated) {
      res.writeHead(410);
      res.end('consumed or missing session');
      return;
    }
    consumed = true;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="authenticated.bin"');
    res.setHeader('Content-Length', payload.length);
    res.end(payload);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const env = { ...process.env, DOWNLOADER_DATA_DIR: data };
const daemon = spawn(nativeBinary, ['daemon'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe'],
});
let daemonError = '';
daemon.stderr.on('data', (data) => (daemonError += data));
let settings;
for (let i = 0; i < 100; i++) {
  try {
    settings = JSON.parse(
      execFileSync(cli, ['--json', 'settings'], {
        env,
        windowsHide: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
if (!settings) throw Error('Native fixture service failed: ' + daemonError);
settings = settings.settings ?? settings;
settings.directory = resolve(dir, 'downloads');
settings.categories = [];
await writeFile(resolve(dir, 'settings.json'), JSON.stringify(settings));
execFileSync(cli, ['--json', 'set', resolve(dir, 'settings.json')], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const projectId = crypto.randomUUID();
const project = {
  id: projectId,
  name: 'Rendered authenticated fixture',
  url: base + '/nav-adapters/gofile/rendered',
  directory: resolve(dir, 'downloads'),
  depth: 2,
  max_pages: 3,
  same_domain: true,
  include: '*.bin',
  exclude: '',
  min_size: 0,
  max_size: null,
  mirror: false,
  rendered: true,
  private: false,
  next_run: null,
};
await writeFile(resolve(dir, 'project.json'), JSON.stringify(project));
execFileSync(cli, ['--json', 'grabber', resolve(dir, 'project.json')], { env, windowsHide: true });
execFileSync(cli, ['--json', 'grabber-run', projectId], { env, windowsHide: true });
const registry =
  (/msedge/i.test(executable)
    ? 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\'
    : 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\') + host;
execFileSync('reg', ['ADD', registry, '/ve', '/t', 'REG_SZ', '/d', nativeManifest, '/f'], {
  windowsHide: true,
  stdio: 'ignore',
});
let browserProc, ws;
let seq = 0;
const pending = new Map();
function command(method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolveResult, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + ' timed out'));
    }, 240000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolveResult(result);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  browserProc = spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
      '--user-data-dir=' + resolve(dir, 'profile'),
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  browserProc.stderr.on('data', (data) => {
    stderr += data;
  });
  let endpoint;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const lines = (await readFile(resolve(dir, 'profile', 'DevToolsActivePort'), 'utf8'))
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!endpoint) throw Error('Browser startup timed out: ' + stderr);
  for (let attempt = 0; attempt < 20; attempt++) {
    ws = new WebSocket(endpoint);
    try {
      await new Promise((r, reject) => {
        ws.onopen = r;
        ws.onerror = reject;
      });
      break;
    } catch (error) {
      ws.close();
      if (attempt === 19) throw Error('CDP connection refused: ' + stderr);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  ws.onclose = () => {
    for (const waiter of pending.values()) waiter.reject(Error('Fixture browser closed'));
    pending.clear();
  };
  ws.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (!event.id) return;
    const waiter = pending.get(event.id);
    pending.delete(event.id);
    event.error ? waiter?.reject(Error(event.error.message)) : waiter?.resolve(event.result);
  };
  const version = await command('Browser.getVersion');
  let loadResult;
  try {
    loadResult = await command('Extensions.loadUnpacked', { path: ext });
  } catch (error) {
    loadResult = { error: String(error) };
  }
  if (loadResult.id && loadResult.id !== extId) {
    extId = loadResult.id;
    await writeFile(
      resolve(data, 'native-allowlist.json'),
      JSON.stringify({ chrome_ids: [extId], firefox_ids: [] }),
    );
    await writeFile(
      nativeManifest,
      JSON.stringify({
        name: host,
        description: 'Isolated Downloader stream fixture',
        path: nativeBinary,
        type: 'stdio',
        allowed_origins: ['chrome-extension://' + extId + '/'],
      }),
    );
  }
  await command('Target.createTarget', { url: 'chrome-extension://' + extId + '/fixture.html' });
  let worker;
  for (let i = 0; i < 100; i++) {
    const targets = await command('Target.getTargets');
    worker = targets.targetInfos.find(
      (t) =>
        t.type === 'service_worker' && t.url === 'chrome-extension://' + extId + '/background.js',
    );
    if (worker) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!worker)
    throw Error(
      'Actual extension could not load in ' +
        version.product +
        ': ' +
        JSON.stringify({ extId, loadResult, targets: await command('Target.getTargets') }),
    );
  const { sessionId } = await command('Target.attachToTarget', {
    targetId: worker.targetId,
    flatten: true,
  });
  const evaluate = async (expression, session = sessionId) => {
    const result = await command(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      session,
    );
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  for (let i = 0; i < 100; i++) {
    if ((await evaluate('typeof fixture')) === 'object') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('fixture: starting owned discovery');
  await evaluate('fixture.setup(' + JSON.stringify(base) + ',' + JSON.stringify(projectId) + ')');
  let state, record;
  for (let i = 0; i < 200; i++) {
    record = await evaluate('Array.from(fixture.discovery.records.values())[0]');
    state = await evaluate(
      'fixture.native("discovery_status",{id:' +
        JSON.stringify(projectId) +
        ',scope:Array.from(fixture.discovery.records.values())[0].scope,generation:1,action:"snapshot"})',
    );
    if (state.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(state.status, 'ready');
  assert.equal(state.resources.length, 1);
  assert.equal(requests.length, 0);
  assert.equal(state.visited_count, 1);
  execFileSync(
    cli,
    ['--json', 'grabber-download', projectId, base + '/nav-adapters/gofile/authenticated.bin'],
    { env, windowsHide: true, stdio: 'ignore' },
  );
  console.log('fixture: selecting resource');
  await evaluate('fixture.discovery.poll()');
  console.log('fixture: selection enrolled');
  const selectedJobs = JSON.parse(
    execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8' }),
  );
  const selected = { jobs: (selectedJobs.jobs ?? selectedJobs).map((job) => job.id) };
  assert.equal(selected.jobs.length, 1);

  let resolverTab;
  for (let i = 0; i < 150; i++) {
    const snapshot = await evaluate('fixture.browserSnapshot()');
    const rows = await evaluate('chrome.storage.local.get(null)');
    const r = rows['resolver-' + selected.jobs[0]];
    if (r?.tabId) {
      resolverTab = r.tabId;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!resolverTab) console.error(JSON.stringify({ jobs: JSON.parse(execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8' })), records: await evaluate('Array.from(fixture.discovery.records.values())'), scopes: await evaluate('fixture.discovery.liveScopes()'), storage: await evaluate('chrome.storage.local.get(null)') }, null, 2));
  assert.ok(
    resolverTab,
    'Owned resolver tab must be enrolled through exact discovery source scope',
  );
  const target = (await command('Target.getTargets')).targetInfos.find(
    (t) =>
      t.type === 'page' &&
      t.url === base + '/nav-adapters/gofile/rendered' &&
      t.targetId !== String(record.sourceTabId),
  );
  const tabs = await evaluate('chrome.tabs.query({})');
  const actual = tabs.find((t) => t.id === resolverTab);
  assert.ok(actual);
  const targets = (await command('Target.getTargets')).targetInfos.filter(
    (t) => t.type === 'page' && t.url === actual.url,
  );
  let tabSession;
  for (let attempt = 0; attempt < 150 && !tabSession; attempt++) {
  for (const candidate of targets) {
    const attached = await command('Target.attachToTarget', {
      targetId: candidate.targetId,
      flatten: true,
    });
    const has = await evaluate(
      '!!document.querySelector("#__downloader_adapter_preview")',
      attached.sessionId,
    );
    if (attempt === 149 && !has) console.error(await evaluate('JSON.stringify({html:document.body.innerText,error:document.documentElement.dataset.fixtureResolverError})',attached.sessionId));
    if (has) {
      tabSession = attached.sessionId;
      break;
    }
    await command('Target.detachFromTarget', { sessionId: attached.sessionId });
  }
    if (!tabSession) await new Promise((r) => setTimeout(r, 100));
  }
  if (!tabSession) console.error(JSON.stringify({requests, context: await evaluate('fixture.resolverContext('+resolverTab+',0)'), jobs: JSON.parse(execFileSync(cli,['--json','list'],{env,windowsHide:true,encoding:'utf8'})), storage: await evaluate('chrome.storage.local.get(null)')},null,2));
  assert.ok(tabSession, 'Real resolver preview must be visible');
  await command('DOM.enable', {}, tabSession);
  const flattened = await command(
    'DOM.getFlattenedDocument',
    { depth: -1, pierce: true },
    tabSession,
  );
  const radio = flattened.nodes.find(
    (node) =>
      node.nodeName === 'INPUT' &&
      node.attributes?.some(
        (attribute, index) => attribute === 'type' && node.attributes[index + 1] === 'radio',
      ),
  );
  const button = flattened.nodes.find((node) => node.nodeName === 'BUTTON');
  assert.ok(radio && button);
  for (const [node, name] of [
    [radio, '__discoveryFixtureRadio'],
    [button, '__discoveryFixtureContinue'],
  ]) {
    const resolved = await command('DOM.resolveNode', { nodeId: node.nodeId }, tabSession);
    await command(
      'Runtime.callFunctionOn',
      {
        objectId: resolved.object.objectId,
        functionDeclaration: 'function(){globalThis[' + JSON.stringify(name) + ']=this;}',
        returnByValue: true,
      },
      tabSession,
    );
  }
  // Drive the real preview after detaching; production chrome.debugger exclusively owns byte capture.
  await command('Target.detachFromTarget', { sessionId: tabSession });
  await evaluate(
    'chrome.scripting.executeScript({target:{tabId:' +
      resolverTab +
      '},world:"MAIN",func:()=>{globalThis.__discoveryFixtureRadio.click();globalThis.__discoveryFixtureContinue.click();delete globalThis.__discoveryFixtureRadio;delete globalThis.__discoveryFixtureContinue;}})',
  );
  let jobs;
  for (let i = 0; i < 400; i++) {
    jobs = JSON.parse(
      execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8' }),
    );
    if (jobs.jobs) jobs = jobs.jobs;
    if (jobs.find((j) => j.id === selected.jobs[0])?.state === 'complete') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const job = jobs.find((j) => j.id === selected.jobs[0]);
  assert.equal(job.state, 'complete');
  const bytes = await readFile(resolve(dir, 'downloads', 'authenticated.bin'));
  assert.equal(bytes.length, payload.length);
  assert.equal(digest(bytes), digest(payload));
  assert.deepEqual(requests, [{ method: 'GET', authenticated: true }]);
  const evidence = {
    browser: version.product,
    productVersion: JSON.parse(await readFile('package.json','utf8')).version,
    sourceCommit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),
    serviceSha256: digest(await readFile(nativeBinary)),
    resolverSha256: digest(await readFile(resolve(ext,'resolver.js'))),
    diagnosticBundleChanges: false,
    os: process.platform,
    architecture: process.arch,
    transport:
      'Production discovery worker/content and resolver, actual native messaging, original response direct streaming',
    resources: state.resources.length,
    visited: state.visited_count,
    bytes: bytes.length,
    sha256: digest(bytes),
    requests,
    pageRequests,
    assertions: [
      'delayed JavaScript resource discovered without a probe',
      'loop deduplicated',
      'scoped selected resource reopened provenance page',
      'authenticated original resource GET consumed once',
      'native storage completed matching SHA-256',
      'driver detached before preview submission; production chrome.debugger exclusively owned response bytes',
    ],
    limitations: [
      'Local fixtures only; live hosts/accounts pending',
      'Firefox/ESR and other OS rows require separate qualification',
    ],
  };
  await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (ws) {
    await command('Browser.close').catch(() => {});
    ws.close();
  }
  browserProc?.kill();
  daemon.kill();
  server.close();
  // Remove only the unique fixture-created registration; user host registrations are never modified.
  execFileSync('reg', ['DELETE', registry, '/f'], { windowsHide: true, stdio: 'ignore' });
}
