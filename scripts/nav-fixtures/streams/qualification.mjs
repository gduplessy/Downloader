import { createServer } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import {
  buildPrivateDriver,
  preparePrivateNavigation,
  auditPrivateNavigation,
} from './private-context.mjs';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
const privateMode = process.env.NAV_PRIVATE === '1';
const privacyMarker = privateMode ? 'private-fixture-' + crypto.randomUUID() : null;
assert.ok(
  !privateMode || process.env.NAV_TRACE !== '1',
  'Private diagnostic source tracing is prohibited',
);
const mode = process.env.NAV_CASE ?? (privateMode ? 'private-blob' : 'blob');
const filename = 'original-雪.bin';
const observations = {};
const runStarted = Date.now();
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const interruptionModes = [
  'capture-cancel',
  'document-replacement',
  'source-replacement',
  'worker-loss',
  'service-reconnect',
  'tab-close',
];
const executable =
  process.env.NAV_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = resolve('.fixture-streams', 'qualification-' + mode + '-' + Date.now());
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
observations.nativeVersion = execFileSync(cli, ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
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
// Build the production entry points. The only source substitution is the isolated native host name.
await build({
  entryPoints: ['apps/extension/src/background.ts', 'apps/extension/src/resolver.ts'],
  outdir: ext,
  nodePaths: [resolve('apps/extension/node_modules')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: JSON.stringify('chromium') },
  plugins: [
    {
      name: 'isolated-fixture-host',
      setup(builder) {
        builder.onLoad(
          { filter: /(?:background|transport|resolver|selection-ui|preview)\.ts$/ },
          async ({ path }) => ({
            contents:
              process.env.NAV_TRACE === '1'
                ? (await readFile(path, 'utf8'))
                    .replaceAll('org.downloader.native', host)
                    .replace(
                      'async function resolverContext(tabId: number, frameId: number, documentId?: string) {',
                      'async function resolverContext(tabId: number, frameId: number, documentId?: string) { console.info("resolver-context-entry",tabId,frameId,documentId);',
                    )
                    .replace(
                      "if (frameId !== 0 || (await browser.tabs.get(tabId)).status !== 'complete') return null;",
                      "const ctxTab = await browser.tabs.get(tabId); console.info('resolver-context-tab',JSON.stringify(ctxTab)); if(frameId !== 0 || ctxTab.status !== 'complete') return null;",
                    )
                    .replace(
                      'if (record.sessionEpoch !== (await browserEpoch)) return null;',
                      "console.info('resolver-context-record',JSON.stringify(record),await browserEpoch); if (record.sessionEpoch !== (await browserEpoch)) return null;",
                    )
                    .replace(
                      'const job = (await browserSnapshot()).jobs.find((job: any) => job.id === entry[0].slice(9));',
                      'const job = (await browserSnapshot()).jobs.find((job: any) => job.id === entry[0].slice(9)); console.info("resolver-context-authority",JSON.stringify({record,job}));',
                    )
                    .replace(
                      '.catch(() => {',
                      '.catch((error) => { console.info("fixture-preview-error",String(error));',
                    )
                    .replace(
                      "if (preview.binding[key] !== current[key]) throw Error('adapter_preview_stale');",
                      "if (preview.binding[key] !== current[key]) { console.info('fixture-binding-diff',key,preview.binding[key],current[key]);throw Error('adapter_preview_stale');}",
                    )
                    .replaceAll(
                      '.catch(() => {})',
                      '.catch(error => console.error("fixture resolver error",String(error)))',
                    )
                : (await readFile(path, 'utf8')).replaceAll('org.downloader.native', host),
            loader: 'ts',
          }),
        );
      },
    },
  ],
});
if (privateMode) {
  await writeFile(
    resolve(ext, 'background.js'),
    '(()=>{const event=chrome.contextMenus.onClicked;const register=event.addListener.bind(event);event.addListener=(listener)=>{globalThis.__fixtureMenuHandler=listener;register(listener);};})();\n' +
      (await readFile(resolve(ext, 'background.js'), 'utf8')),
  );
  await buildPrivateDriver({ build, ext });
} else await writeFile(resolve(ext, 'options.html'), '<script src="wake.js"></script>');
await writeFile(
  resolve(ext, 'wake.js'),
  'setInterval(()=>chrome.runtime.sendMessage({type:"fixture_ping"}).catch(()=>{}),500)',
);
await writeFile(
  resolve(ext, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    incognito: 'split',
    key,
    name: 'Downloader direct-stream fixture',
    version: '0.1.0',
    permissions: [
      'debugger',
      'nativeMessaging',
      'cookies',
      'tabs',
      'scripting',
      'storage',
      'webRequest',
      'downloads',
      'contextMenus',
      'alarms',
    ],
    host_permissions: ['http://127.0.0.1/*'],
    background: { service_worker: 'background.js' },
  }),
);
const payload = Buffer.alloc(Number(process.env.NAV_BYTES ?? 8 * 1024 * 1024 + 17));
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + (privateMode ? 113 : 7)) % 251;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requests = [];
const originRequests = [];
const server = createServer(async (req, res) => {
  originRequests.push({
    method: req.method,
    path: req.url.split('?')[0],
    browser: /Chrome|Edg/.test(req.headers['user-agent'] ?? ''),
  });
  if (req.url.startsWith('/nav-adapters/g4u/blob')) {
    res.setHeader('Content-Type', 'text/html');
    const seed = privateMode && (req.headers.cookie ?? '').includes(privacyMarker) ? 113 : 7;
    res.end(
      '<!doctype html><title>Owned blob fixture</title><script>const bytes=new Uint8Array(' +
        payload.length +
        ');for(let i=0;i<bytes.length;i++)bytes[i]=(i*31+' +
        seed +
        ')%251;const original=URL.createObjectURL(new Blob([bytes]));addEventListener("DOMContentLoaded",()=>{const a=document.querySelector("a");a.href=original;window.fixtureBlob=original;window.originalClicks=0;a.addEventListener("click",()=>window.originalClicks++);});</script><a data-nav-fixture-control download="original-雪.bin">Download original file</a>',
    );
  } else if (req.url === '/nav-adapters/g4u/post') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<form method="POST" action="/one-use"><input name="token" value="fixture-token"><button data-nav-fixture-control>Download</button></form>',
    );
  } else if (req.url === '/one-use') {
    const body = [];
    for await (const chunk of req) body.push(chunk);
    requests.push({ method: req.method, body: Buffer.concat(body).toString() });
    if (requests.length !== 1 || req.method !== 'POST') {
      res.writeHead(410);
      res.end('consumed');
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="original-post.bin"');
    res.setHeader('Content-Length', payload.length);
    res.end(payload);
  } else {
    res.writeHead(404);
    res.end();
  }
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
const registry =
  (/msedge/i.test(executable)
    ? 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\'
    : 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\') + host;
execFileSync('reg', ['ADD', registry, '/ve', '/t', 'REG_SZ', '/d', nativeManifest, '/f'], {
  windowsHide: true,
  stdio: 'ignore',
});
let browserProc, ws, heapMonitor, restartedDaemon;
const heapSamples = [];
let seq = 0;
const pending = new Map();
const consoleEvents = [];
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
    if (event.method === 'Target.attachedToTarget')
      void command('Runtime.enable', {}, event.params.sessionId).catch(() => {});
    if (event.method === 'Runtime.consoleAPICalled')
      consoleEvents.push(event.params.args.map((arg) => arg.value ?? arg.description));
    if (!event.id) return;
    const waiter = pending.get(event.id);
    pending.delete(event.id);
    event.error ? waiter?.reject(Error(event.error.message)) : waiter?.resolve(event.result);
  };
  const version = await command('Browser.getVersion');

  let loadResult;
  try {
    loadResult = await command('Extensions.loadUnpacked', {
      path: ext,
      ...(privateMode ? { enableInIncognito: true } : {}),
    });
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
  const fixtureTarget = await command('Target.createTarget', {
    url: 'chrome-extension://' + extId + '/options.html',
  });
  let { sessionId: pageSession } = await command('Target.attachToTarget', {
    targetId: fixtureTarget.targetId,
    flatten: true,
  });
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
  let { sessionId } = await command('Target.attachToTarget', {
    targetId: worker.targetId,
    flatten: true,
  });
  await command('Runtime.enable', {}, sessionId);
  let heapSessionId = sessionId;
  let heapPending = false;
  heapMonitor = setInterval(() => {
    if (heapPending) return;
    heapPending = true;
    void command('Runtime.getHeapUsage', {}, heapSessionId)
      .then((heap) => heapSamples.push(heap.usedSize))
      .catch(() => {})
      .finally(() => (heapPending = false));
  }, 250);
  const regularDriverSession = pageSession;
  let evaluate = async (expression) => {
    const value = await command(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      regularDriverSession,
    );
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails));
    return value.result?.value;
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await evaluate('globalThis.chrome?.runtime?.id').catch(() => null)) === extId) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    await evaluate('globalThis.chrome?.runtime?.id'),
    extId,
    'Actual fixture extension driver did not finish loading',
  );
  await evaluate(
    `chrome.storage.local.set({settings:{automatic:false,directCapture:true,extensions:[],excluded:[],bypassUntil:0,locale:'en',overlay:false}})`,
  );
  await evaluate(`chrome.runtime.sendMessage({type:'settings_changed'})`);
  const regularEvaluate = evaluate;
  let jobId, ownedTab, pageTarget, privateContext;
  if (privateMode) {
    privateContext = await preparePrivateNavigation({
      command,
      evaluate,
      extId,
      fixtureTarget,
      base,
      cli,
      env,
      privacyMarker,
    });
    ({ jobId, ownedTab, pageTarget, evaluate, pageSession } = privateContext);
    worker = privateContext.worker;
    sessionId = worker.sessionId;
    heapSessionId = sessionId;
    heapSamples.splice(0);
  } else {
    const added = JSON.parse(
      execFileSync(
        cli,
        [
          '--json',
          'add',
          base + '/nav-adapters/g4u/blob',
          '--navigate',
          '--paused',
          '--filename',
          filename,
        ],
        { env, windowsHide: true, encoding: 'utf8', timeout: 8000 },
      ),
    );
    jobId = (added.job ?? added).id;
    assert.ok(jobId, JSON.stringify(added));
    await evaluate(
      `chrome.runtime.sendMessage({type:'navigation_queue_continue',id:${JSON.stringify(jobId)}})`,
    );

    ownedTab = await evaluate(
      '(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(t=>t.url?.includes("/nav-adapters/g4u/blob"));})()',
    );
    assert.ok(ownedTab?.id, 'No production-owned blob tab');
    const targets = await command('Target.getTargets');
    pageTarget = targets.targetInfos.find(
      (t) => t.type === 'page' && t.url === base + '/nav-adapters/g4u/blob',
    );
    assert.ok(pageTarget, 'No owned page target');
  }
  const { sessionId: ownedSession } = await command('Target.attachToTarget', {
    targetId: pageTarget.targetId,
    flatten: true,
  });
  const page = async (expression) => {
    const r = await command(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      ownedSession,
    );
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const nodes = (root) => {
    const all = [];
    const walk = (n) => {
      all.push(n);
      for (const child of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(child);
    };
    walk(root);
    return all;
  };
  const attributes = (n) =>
    Object.fromEntries(
      Array.from({ length: (n.attributes ?? []).length / 2 }, (_, i) => [
        n.attributes[i * 2],
        n.attributes[i * 2 + 1],
      ]),
    );
  const shadow = async () => {
    const tree = await command('DOM.getDocument', { depth: -1, pierce: true }, ownedSession);
    const host = nodes(tree.root).find((n) => attributes(n).id === '__downloader_adapter_preview');
    return host?.shadowRoots?.[0];
  };
  const deadlinePreview = Date.now() + 60000;
  let preview;
  while (Date.now() < deadlinePreview) {
    preview = await shadow();
    if (preview) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(preview, 'Production resolver did not open Blob preview');
  await new Promise((r) => setTimeout(r, 500));
  preview = await shadow();
  async function clickNode(node) {
    const { model } = await command('DOM.getBoxModel', { nodeId: node.nodeId }, ownedSession);
    const box = model.content;
    const x = (box[0] + box[2]) / 2,
      y = (box[1] + box[5]) / 2;
    await command(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x, y, button: 'left', clickCount: 1 },
      ownedSession,
    );
    await command(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 },
      ownedSession,
    );
  }
  async function button(text) {
    const root = await shadow();
    const found = nodes(root).find(
      (n) => n.nodeName === 'BUTTON' && nodes(n).some((c) => c.nodeValue === text),
    );
    assert.ok(found, 'Preview button ' + text + ' missing');
    return found;
  }
  if (mode === 'preview-cancel') await clickNode(await button('Cancel'));
  else {
    const radio = nodes(preview).find(
      (n) => n.nodeName === 'INPUT' && attributes(n).type === 'radio',
    );
    assert.ok(radio, 'Blob preview lacks selectable control');
    await clickNode(radio);
    const radioObject = await command('DOM.resolveNode', { nodeId: radio.nodeId }, ownedSession);
    const radioValue = await command(
      'Runtime.callFunctionOn',
      {
        objectId: radioObject.object.objectId,
        functionDeclaration: 'function(){return {checked:this.checked,disabled:this.disabled}}',
        returnByValue: true,
      },
      ownedSession,
    );
    observations.radio = radioValue.result.value;
    assert.equal(observations.radio.checked, true, 'Actual radio was not selected');
    if (mode === 'blob-revoked') await page('URL.revokeObjectURL(window.fixtureBlob)');
    if (mode === 'preview-document-replacement') {
      await page(
        'document.querySelector("a").replaceWith(Object.assign(document.createElement("a"),{href:window.fixtureBlob,download:"replacement.bin",textContent:"Download replacement"}))',
      );
    }
    const continueNode = await button('Continue');
    const continueObject = await command(
      'DOM.resolveNode',
      { nodeId: continueNode.nodeId },
      ownedSession,
    );
    const continueValue = await command(
      'Runtime.callFunctionOn',
      {
        objectId: continueObject.object.objectId,
        functionDeclaration: 'function(){return {disabled:this.disabled}}',
        returnByValue: true,
      },
      ownedSession,
    );
    observations.continue = continueValue.result.value;
    assert.equal(observations.continue.disabled, false, 'Actual Continue remains disabled');
    await clickNode(continueNode);
  }
  let job;
  if (process.env.NAV_TRACE === '1') {
    const scopeProbe = await evaluate(
      `(async()=>{const tabs=await chrome.tabs.query({});const owned=tabs.find(t=>t.url?.includes('/nav-adapters/'));const results=[];for(const details of [{tabId:owned.id,frameId:0},{tabId:owned.id}]){try{results.push({details,value:await chrome.cookies.getPartitionKey(details)})}catch(error){results.push({details,error:String(error)})}}return {owned,results}})()`,
    );
    console.log(JSON.stringify({ scopeProbe }));
  }
  const deadline = Date.now() + Number(process.env.NAV_DEADLINE_MS ?? 90000);
  const negative = [
    'preview-cancel',
    'preview-document-replacement',
    'blob-revoked',
    'capture-cancel',
    'document-replacement',
    'source-replacement',
    'worker-loss',
    'tab-close',
  ].includes(mode);
  let interruptionApplied = false;
  let interruptAt;
  const transferStarted = Date.now();
  let firstProgressAt;
  const progressSamples = [];
  for (let attempt = 0; attempt < 600 && Date.now() < deadline; attempt++) {
    const listed = JSON.parse(
      execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8' }),
    );
    job = (listed.jobs ?? listed).find((item) => item.id === jobId);
    if (job?.bytes > 0) {
      firstProgressAt ??= Date.now();
      if (progressSamples.at(-1)?.bytes !== job.bytes)
        progressSamples.push({ elapsedMs: Date.now() - transferStarted, bytes: job.bytes });
    }
    if (
      !['preview-cancel', 'preview-document-replacement'].includes(mode) &&
      job?.bytes === 0 &&
      job.state === 'waiting_user' &&
      (observations.previewRefreshes ?? 0) < 3
    ) {
      const current = await shadow().catch(() => undefined);
      const stale =
        current &&
        nodes(current).some((n) => n.nodeValue === 'Page changed. Refresh the selection.');
      if (stale) {
        await clickNode(await button('Refresh'));
        let fresh;
        for (let count = 0; count < 100; count++) {
          fresh = await shadow();
          if (fresh) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        assert.ok(fresh, 'Refresh did not reopen preview');
        const radio = nodes(fresh).find(
          (n) => n.nodeName === 'INPUT' && attributes(n).type === 'radio',
        );
        await clickNode(radio);
        await clickNode(await button('Continue'));
        observations.previewRefreshes = (observations.previewRefreshes ?? 0) + 1;
      }
    }
    if (
      interruptionModes.includes(mode) &&
      !interruptionApplied &&
      job?.bytes > 0 &&
      job.state !== 'complete'
    ) {
      interruptionApplied = true;
      interruptAt = Date.now();
      observations.bytesAtInterruption = job.bytes;
      if (mode === 'capture-cancel')
        await evaluate(
          'chrome.runtime.sendMessage({type:"cancel_capture",id:' + JSON.stringify(jobId) + '})',
        );
      if (mode === 'document-replacement') await command('Page.reload', {}, ownedSession);
      if (mode === 'source-replacement')
        execFileSync(
          cli,
          ['--json', 'refresh', jobId, base + '/nav-adapters/g4u/blob?replacement=1'],
          { env, windowsHide: true, encoding: 'utf8', timeout: 8000 },
        );
      if (mode === 'tab-close') await evaluate('chrome.tabs.remove(' + ownedTab.id + ')');
      if (mode === 'worker-loss') {
        clearInterval(heapMonitor);
        await command('Target.detachFromTarget', { sessionId });
        await command('ServiceWorker.enable', {}, pageSession);
        await command('ServiceWorker.stopAllWorkers', {}, pageSession);
        await new Promise((r) => setTimeout(r, 500));
        observations.oldWorkerGone = !(await command('Target.getTargets')).targetInfos.some(
          (t) => t.targetId === worker.targetId,
        );
        assert.equal(
          observations.oldWorkerGone,
          true,
          'CDP did not actually stop the production worker',
        );
      }
      if (mode === 'service-reconnect') {
        daemon.kill();
        await new Promise((r) => daemon.once('exit', r));
        restartedDaemon = spawn(nativeBinary, ['daemon'], {
          env,
          windowsHide: true,
          stdio: 'ignore',
        });
        observations.daemonRestarted = true;
      }
    }
    if (
      negative &&
      ((!interruptionModes.includes(mode) && attempt >= 10) ||
        (interruptionApplied && Date.now() - interruptAt > 3500))
    )
      break;
    if (job?.state === 'complete') break;
    if (['failed', 'cancelled'].includes(job?.state))
      throw Error(JSON.stringify({ job, requests }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  observations.durationMs = Date.now() - runStarted;
  observations.transferElapsedMs = Date.now() - transferStarted;
  observations.firstDurableProgressMs = firstProgressAt ? firstProgressAt - transferStarted : null;
  observations.progressSamples = progressSamples;
  observations.measuredBytesPerSecond =
    job?.state === 'complete'
      ? Math.round((job.bytes * 1000) / observations.transferElapsedMs)
      : null;
  observations.originalClicks =
    mode === 'tab-close' ? null : await page('window.originalClicks').catch(() => null);
  observations.previewStillVisible =
    mode === 'tab-close' ? false : Boolean(await shadow().catch(() => undefined));
  observations.interruptionApplied = interruptionApplied;
  if (interruptionModes.includes(mode))
    assert.ok(interruptionApplied, 'Fixture missed in-progress interruption window');
  observations.private = privateMode;
  if (privateMode) {
    observations.privateCookieStore = privateContext.membership.id;
    observations.workerIncognito = true;
    observations.sourceActivation =
      'synthetic event invoking unchanged registered production menu handler with actual private tab';
    Object.assign(
      observations,
      await auditPrivateNavigation({
        evaluateRegular: regularEvaluate,
        jobId,
        privacyMarker,
        data,
      }),
    );
  }
  const currentPreview = await shadow().catch(() => undefined);
  observations.previewText = currentPreview
    ? nodes(currentPreview)
        .filter((n) => n.nodeName === '#text')
        .map((n) => n.nodeValue)
        .join(' ')
    : null;
  observations.consoleEvents = privateMode ? [] : consoleEvents;
  observations.lastError =
    (await evaluate('chrome.storage.local.get("lastError")')).lastError ?? null;
  observations.nativeOriginRequests = originRequests.filter((row) => !row.browser).length;
  const fixtureChecks = await evaluate('chrome.runtime.sendMessage({type:"capture_status"})');
  observations.captureStates = fixtureChecks.map((row) => row.state);
  observations.typedRecoveryReason = job?.error?.match(/^([a-z_]+):/)?.[1] ?? null;
  observations.adapter = {
    id: job?.navigation_adapter?.id ?? null,
    version: job?.navigation_adapter?.version ?? null,
    selectedHost: job?.selected_host ?? null,
  };
  observations.publishedFileExists = await readFile(
    resolve(dir, 'downloads', privateMode ? 'blob' : filename),
  ).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  if (negative) {
    assert.equal(
      observations.publishedFileExists,
      false,
      'Interrupted Blob must not publish a file',
    );
    assert.notEqual(job?.state, 'complete');
    if (!interruptionModes.includes(mode)) assert.equal(job.bytes, 0);
    if (observations.originalClicks !== null) assert.equal(observations.originalClicks, 0);
  } else if (job?.state === 'complete') {
    const bytes = await readFile(resolve(dir, 'downloads', privateMode ? 'blob' : filename));
    assert.equal(bytes.length, payload.length);
    assert.equal(digest(bytes), digest(payload));
    if (privateMode) {
      const regularExpected = Buffer.alloc(payload.length);
      for (let i = 0; i < regularExpected.length; i++) regularExpected[i] = (i * 31 + 7) % 251;
      observations.differsFromRegularExpected = digest(bytes) !== digest(regularExpected);
      assert.equal(observations.differsFromRegularExpected, true);
    }
  }
  assert.deepEqual(requests, [], 'Blob path must not issue POST/HEAD/GET to response URL');
  clearInterval(heapMonitor);
  observations.workerHeap = {
    samples: heapSamples.length,
    baselineBytes: heapSamples[0] ?? null,
    peakBytes: heapSamples.length ? Math.max(...heapSamples) : null,
  };
  const typedRecovery =
    !interruptionModes.includes(mode) ||
    mode === 'service-reconnect' ||
    ['waiting_user', 'waiting_source', 'failed', 'cancelled', 'paused'].includes(job?.state);
  const accepted = negative ? typedRecovery : job?.state === 'complete';
  const driverSha256 = digest(await readFile(new URL(import.meta.url)));
  const evidence = {
    driverSha256,
    acceptance: accepted
      ? process.env.NAV_TRACE === '1'
        ? 'diagnostic-passed'
        : 'passed'
      : 'pending',
    mode,
    browser: version.product,
    os: process.platform,
    architecture: process.arch,
    checkedBase: process.env.NAV_CHECKED_BASE ?? '7e44b00',
    sourceRevision,
    productionBackground: true,
    productionResolver: true,
    diagnosticSourceChanges: process.env.NAV_TRACE === '1',
    driver: 'real radio/Continue/Cancel mouse events in closed production preview',
    nativeTransport: 'persistent connectNative',
    source: 'original page-owned Blob',
    expectedBytes: payload.length,
    actualBytes: job?.bytes,
    sha256: job?.state === 'complete' ? digest(payload) : null,
    state: job?.state,
    source_generation: job?.source_generation,
    claim_generation: job?.navigation_scope?.claim_generation,
    originResponseRequests: requests.length,
    originRequests,
    observations,
    limitations: [
      'Local fixtures; live providers and permission prompt pending',
      ...(privateMode
        ? [
            'Private source activation uses approved synthetic context-menu event; native menu UI pending',
          ]
        : []),
      'No Firefox ESR or unavailable OS qualification from this run',
    ],
  };
  await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  assert.ok(
    accepted,
    'Production recovery/result is not yet qualified; preserved ' + resolve(dir, 'evidence.json'),
  );
} catch (error) {
  let latest;
  try {
    const snapshot = JSON.parse(
      execFileSync(cli, ['--json', 'list'], {
        env,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 5000,
      }),
    );
    latest = (snapshot.jobs ?? snapshot)[0];
  } catch {}
  await writeFile(
    resolve(dir, 'failure.json'),
    JSON.stringify(
      {
        mode,
        error: privateMode
          ? String(error).replaceAll(privacyMarker, '<private-fixture>')
          : String(error),
        checkedBase: process.env.NAV_CHECKED_BASE ?? '7e44b00',
        browser: executable,
        state: latest?.state,
        bytes: latest?.bytes,
        source_generation: latest?.source_generation,
        claim_generation: latest?.navigation_scope?.claim_generation,
        originRequests,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  clearInterval(heapMonitor);
  if (ws) {
    if (ws.readyState === WebSocket.OPEN) await command('Browser.close').catch(() => {});
    ws.close();
  }
  browserProc?.kill();
  try {
    execFileSync(cli, ['quit'], { env, windowsHide: true, stdio: 'ignore', timeout: 5000 });
  } catch {}
  daemon.kill();
  restartedDaemon?.kill();
  server.close();
  // Remove only the unique fixture-created registration; user host registrations are never modified.
  execFileSync('reg', ['DELETE', registry, '/f'], { windowsHide: true, stdio: 'ignore' });
}
