import { createServer } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
const executable =
  process.env.NAV_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = resolve('.fixture-streams', 'production-worker-' + Date.now());
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
        builder.onLoad({ filter: /(?:background|transport|resolver)\.ts$/ }, async ({ path }) => ({
          contents: process.env.NAV_TRACE === '1' ? (await readFile(path, 'utf8'))
            .replaceAll('org.downloader.native', host)
            .replace(
              'async function resolverContext(tabId: number, frameId: number, documentId?: string) {',
              'async function resolverContext(tabId: number, frameId: number, documentId?: string) { console.info("resolver-context-entry",tabId,frameId,documentId);',
            )
            .replace("if (frameId !== 0 || (await browser.tabs.get(tabId)).status !== 'complete') return null;", "const ctxTab = await browser.tabs.get(tabId); console.info('resolver-context-tab',JSON.stringify(ctxTab)); if(frameId !== 0 || ctxTab.status !== 'complete') return null;")
            .replace("if (record.sessionEpoch !== (await browserEpoch)) return null;", "console.info('resolver-context-record',JSON.stringify(record),await browserEpoch); if (record.sessionEpoch !== (await browserEpoch)) return null;")
            .replace(
              'const job = (await browserSnapshot()).jobs.find((job: any) => job.id === entry[0].slice(9));',
              'const job = (await browserSnapshot()).jobs.find((job: any) => job.id === entry[0].slice(9)); console.info("resolver-context-authority",JSON.stringify({record,job}));',
            )
            .replaceAll(
              '.catch(() => {})',
              '.catch(error => console.error("fixture resolver error",String(error)))',
            ) : (await readFile(path, 'utf8')).replaceAll('org.downloader.native', host),
          loader: 'ts',
        }));
      },
    },
  ],
});
await writeFile(resolve(ext, 'options.html'), '<script src="wake.js"></script>');
await writeFile(
  resolve(ext, 'wake.js'),
  'setInterval(()=>chrome.runtime.sendMessage({type:"fixture_ping"}).catch(()=>{}),500)',
);
await writeFile(
  resolve(ext, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
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
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) % 251;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === '/nav-adapters/g4u/post') {
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
let browserProc, ws;
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
  const fixtureTarget = await command('Target.createTarget', {
    url: 'chrome-extension://' + extId + '/options.html',
  });
  const { sessionId: pageSession } = await command('Target.attachToTarget', {
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
  const { sessionId } = await command('Target.attachToTarget', {
    targetId: worker.targetId,
    flatten: true,
  });
  await command('Runtime.enable', {}, sessionId);
  const evaluate = async (expression) => {
    const value = await command(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      pageSession,
    );
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails));
    return value.result?.value;
  };
  await evaluate(
    `chrome.storage.local.set({settings:{automatic:false,directCapture:true,extensions:[],excluded:[],bypassUntil:0,locale:'en',overlay:false}})`,
  );
  await evaluate(`chrome.runtime.sendMessage({type:'settings_changed'})`);
  const added = JSON.parse(
    execFileSync(
      cli,
      [
        '--json',
        'add',
        base + '/nav-adapters/g4u/post',
        '--navigate',
        '--paused',
        '--filename',
        'original-post.bin',
      ],
      { env, windowsHide: true, encoding: 'utf8' },
    ),
  );
  const jobId = (added.job ?? added).id;
  assert.ok(jobId, JSON.stringify(added));
  await evaluate(
    `chrome.runtime.sendMessage({type:'navigation_queue_continue',id:${JSON.stringify(jobId)}})`,
  );
  let job;
  if (process.env.NAV_TRACE === '1') {
  const scopeProbe = await evaluate(
    `(async()=>{const tabs=await chrome.tabs.query({});const owned=tabs.find(t=>t.url?.includes('/nav-adapters/'));const results=[];for(const details of [{tabId:owned.id,frameId:0},{tabId:owned.id}]){try{results.push({details,value:await chrome.cookies.getPartitionKey(details)})}catch(error){results.push({details,error:String(error)})}}return {owned,results}})()`,
  );
  console.log(JSON.stringify({ scopeProbe }));
  }
  const deadline = Date.now() + Number(process.env.NAV_DEADLINE_MS ?? 90000);
  for (let attempt = 0; attempt < 600 && Date.now() < deadline; attempt++) {
    const listed = JSON.parse(
      execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8' }),
    );
    job = (listed.jobs ?? listed).find((item) => item.id === jobId);
    if (job?.state === 'complete') break;
    if (['failed', 'cancelled'].includes(job?.state))
      throw Error(JSON.stringify({ job, requests }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(
    job?.state,
    'complete',
    JSON.stringify({
      job,
      requests,
      consoleEvents,
      extensionSnapshot: await evaluate(`chrome.runtime.sendMessage({type:'snapshot'})`),
      diagnostics: await evaluate(`chrome.runtime.sendMessage({type:'diagnostics'})`),
    }),
  );
  const run = {
    result: { value: { jobs: [job], productionBackground: true, productionResolver: true } },
  };
  assert.deepEqual(requests, [{ method: 'POST', body: 'token=fixture-token' }]);
  for (const file of ['original-post.bin']) {
    const bytes = await readFile(resolve(dir, 'downloads', file));
    assert.equal(bytes.length, payload.length);
    assert.equal(digest(bytes), digest(payload));
  }
  assert.ok(run.result.value.jobs.every((job) => job.state === 'complete'));
  const evidence = {
    browser: version.product,
    os: process.platform,
    architecture: process.arch,
    extensionAPI: 'chrome.debugger Fetch.takeResponseBodyAsStream / IO.read',
    transport: 'persistent chrome.runtime.connectNative',
    diagnosticSourceChanges: process.env.NAV_TRACE === '1',
    submissions: requests.length,
    sha256: digest(payload),
    ...run.result.value,
    limitations: [
      'Local fixtures; live hosts/accounts pending',
      'No stable/ESR Firefox or other OS qualification from this run',
      'Fixture manifest grants loopback optional permissions; runtime permission prompt is not qualified',
      'Only POST full-worker acceptance in this increment; blob/cancel/replacement matrix pending',
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
