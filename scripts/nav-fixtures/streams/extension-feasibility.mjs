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
const dir = resolve('.fixture-streams', 'extension-' + Date.now());
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
await build({
  entryPoints: ['scripts/nav-fixtures/streams/extension-harness.ts'],
  outfile: resolve(ext, 'background.js'),
  nodePaths: [resolve('apps/extension/node_modules')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
});
await writeFile(resolve(ext, 'fixture.html'), '<script src="wake.js"></script>');
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
    permissions: ['debugger', 'nativeMessaging', 'cookies', 'tabs', 'scripting', 'storage'],
    host_permissions: ['http://127.0.0.1/*'],
    background: { service_worker: 'background.js' },
  }),
);
const payload = Buffer.alloc(Number(process.env.NAV_BYTES ?? 8 * 1024 * 1024 + 17));
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) % 251;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<form method="POST" action="/one-use"><input name="token" value="fixture-token"><button>Download</button></form>',
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
  for (let i = 0; i < 100; i++) {
    const ready = await command(
      'Runtime.evaluate',
      { expression: 'typeof runFixture', returnByValue: true },
      sessionId,
    );
    if (ready.result?.value === 'function') break;
    if (i === 99) throw Error('Fixture worker startup failed: ' + JSON.stringify(ready));
    await new Promise((r) => setTimeout(r, 100));
  }
  const run = await command(
    'Runtime.evaluate',
    {
      expression:
        'Promise.race([new Promise((_,reject)=>setTimeout(()=>reject(Error("Fixture timed out at "+fixtureStage)),180000)),runFixture(' +
        JSON.stringify(base) +
        ',' +
        JSON.stringify(host) +
        ',' +
        payload.length +
        ')])',
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  );
  if (run.exceptionDetails) {
    const diagnostic = await command(
      'Runtime.evaluate',
      {
        expression:
          'JSON.stringify({stage:globalThis.fixtureStage,events:globalThis.fixtureDebug})',
        returnByValue: true,
      },
      sessionId,
    );
    throw Error(JSON.stringify({ exception: run.exceptionDetails, diagnostic, requests }));
  }
  assert.deepEqual(requests, [{ method: 'POST', body: 'token=fixture-token' }]);
  for (const file of ['original-post.bin', 'original-blob.bin']) {
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
    submissions: requests.length,
    sha256: digest(payload),
    ...run.result.value,
    limitations: [
      'Local fixtures; live hosts/accounts pending',
      'No stable/ESR Firefox or other OS qualification from this run',
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
