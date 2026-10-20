import { createServer } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, copyFile, realpath } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
const executable =
  process.env.NAV_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = resolve('.fixture-streams', 'reader-liveness-' + Date.now());
const sourceRoot = process.cwd();
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const nativeBuildRevision = execFileSync(
  'git',
  ['rev-parse', process.env.NAV_NATIVE_REVISION ?? '3b808ae1967a210fc5b3a3e461488b9f2ab6cb61'],
  { encoding: 'utf8', windowsHide: true },
).trim();
assert.equal(nativeBuildRevision, '3b808ae1967a210fc5b3a3e461488b9f2ab6cb61');
const initialDriverSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const idleMs = 60000;
const pollMs = Number(process.env.NAV_POLL_MS ?? 200);
assert.ok(Number.isSafeInteger(pollMs) && pollMs >= 200 && pollMs <= 5000, 'Poll interval must be 200..5000ms');
const totalDeadlineMs = Number(process.env.NAV_DEADLINE_MS ?? 150000);
assert.ok(Number.isSafeInteger(totalDeadlineMs) && totalDeadlineMs >= 60000 && totalDeadlineMs <= 600000, 'Total deadline must be 60000..600000ms');
const polling = {intervalMs:pollMs, totalDeadlineMs, calls:0, totalCliMs:0, maximumCliMs:0};
const firstChunkBytes = 192 * 1024;
const idle = { requestedMs: idleMs };
const observations = {
  sourceRevision,
  nativeBuildRevision,
  diagnosticSourceChanges: false,
  rendererShim: false,
  idle,
};
observations.polling = polling;
assert.deepEqual(JSON.parse(JSON.stringify(observations)).polling, polling);
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
const nativeBinary = resolve(dir, 'downloader-service.exe');
const cli = resolve(dir, 'downloader.exe');
await copyFile(
  await realpath(
    process.env.NAV_NATIVE_BINARY ??
      'C:/Users/gduplessy/code/Downloader/.fixture-streams/native-pairs/3b808ae-0.25.1/downloader-service.exe',
  ),
  nativeBinary,
);
await copyFile(
  await realpath(
    process.env.NAV_CLI_BINARY ?? 'C:/Users/gduplessy/code/Downloader/.fixture-streams/native-pairs/3b808ae-0.25.1/downloader.exe',
  ),
  cli,
);
const binaryDigest = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
observations.nativeBinarySha256 = await binaryDigest(nativeBinary);
observations.cliBinarySha256 = await binaryDigest(cli);
assert.equal(observations.nativeBinarySha256, '3cbd6aa2c7d65e2c4aeaabd83afed64d86e838d2c898fd8f63cb1083804056f2', 'Immutable service mismatch');
assert.equal(observations.cliBinarySha256, '43094f64f3379c39cd24c0e3358df77d0931afa9dd81a80a9550d16e57787e0c', 'Immutable CLI mismatch');
assert.match(
  execFileSync(cli, ['--version'], { encoding: 'utf8', windowsHide: true }),
  /0\.25\.1/,
);

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
// Production code is unchanged except the unique native-host address.
const compilation = await build({
  absWorkingDir: sourceRoot,
  metafile: true,
  entryPoints: [
    resolve('apps/extension/src/background.ts'),
    resolve('apps/extension/src/resolver.ts'),
  ],
  outdir: ext,
  nodePaths: [resolve('apps/extension/node_modules')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: JSON.stringify('chromium') },
  plugins: [
    {
      name: 'isolated-host',
      setup(builder) {
        builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
          contents: (await readFile(path, 'utf8')).replaceAll('org.downloader.native', host),
          loader: 'ts',
          resolveDir: resolve(path, '..'),
        }));
      },
    },
  ],
});
const productionInputs = Object.keys(compilation.metafile.inputs).filter(
  (path) => !path.replaceAll('\\', '/').includes('node_modules/'),
);
assert.ok(
  productionInputs.some((path) =>
    path.replaceAll('\\', '/').endsWith('navigation/streams/transport.ts'),
  ),
);
observations.productionSourceHashes = Object.fromEntries(
  await Promise.all(
    productionInputs.map(async (path) => [
      relative(sourceRoot, resolve(path)).replaceAll('\\', '/'),
      await binaryDigest(resolve(path)),
    ]),
  ),
);
observations.buildProvenance = {
  explicitAbsWorkingDir: true,
  absoluteEntryPoints: true,
  nativeHostAddressOnlySubstitution: true,
};
observations.bundleHashes = {
  background: await binaryDigest(resolve(ext, 'background.js')),
  resolver: await binaryDigest(resolve(ext, 'resolver.js')),
};
await writeFile(resolve(ext, 'options.html'), '<script src="wake.js"></script>');
await writeFile(
  resolve(ext, 'wake.js'),
  '// Isolated settings driver; no periodic wake or byte relay.',
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
      'webNavigation',
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
const allRequests = [];
let releaseIdle;
const idleReleased = new Promise((resolve) => {
  releaseIdle = resolve;
});
const server = createServer(async (req, res) => {
  allRequests.push({ method: req.method, path: req.url });
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
    res.flushHeaders();
    await new Promise((resolve) => res.write(payload.subarray(0, firstChunkBytes), resolve));
    idle.responseFirstChunkWrittenAt = Date.now();
    await idleReleased;
    idle.responseTailWrittenAt = Date.now();
    res.end(payload.subarray(firstChunkBytes));
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
let browserStartedAt = 0;
let browserIdentity;
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
  browserStartedAt = Date.now();
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
  const evaluate = async (expression) => {
    const value = await command(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      pageSession,
    );
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails));
    return value.result?.value;
  };
  let driverReady = false;
  for (let attempt=0;attempt<100;attempt++) {
    driverReady = await evaluate('Boolean(globalThis.chrome?.storage?.local && chrome.runtime?.id === '+JSON.stringify(extId)+')').catch(()=>false);
    if(driverReady) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(driverReady,true,'Actual extension settings driver did not finish loading');
  observations.navigationPermissionsPregranted = await evaluate("chrome.permissions.contains({permissions:['webRequest','cookies','scripting','webNavigation'],origins:['http://127.0.0.1/*']})");
  assert.equal(observations.navigationPermissionsPregranted, true, 'Fixture manifest must grant current navigation permissions');
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
  // The production resolver follows this fixture's unambiguous free form control.
  // Do not attach the driver to its capture target or inspect a loading attachment document.
  observations.initialActivation =
    'Explicit native navigation job and extension navigation_queue_continue fixture action';
  observations.productionControl = 'Unchanged resolver follows the original POST form control';
  observations.capturePageDriverAttached = false;
  observations.previewUiQualified = false;
  await command('Target.closeTarget', { targetId: fixtureTarget.targetId });
  const deadline = Date.now() + totalDeadlineMs;
  let idleTimer;
  const idleSamples = [];
  for (let attempt = 0; attempt < 900 && Date.now() < deadline; attempt++) {
    const pollStarted = performance.now();
    const listed = JSON.parse(
      execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8' }),
    );
    const cliMs = performance.now() - pollStarted;
    polling.calls++; polling.totalCliMs += cliMs; polling.maximumCliMs = Math.max(polling.maximumCliMs, cliMs);
    job = (listed.jobs ?? listed).find((item) => item.id === jobId);
    if (job?.bytes === firstChunkBytes && !idle.durablePartialObservedAt) {
      assert.equal(job.state, 'browser_downloading');
      assert.equal(
        job.bytes,
        firstChunkBytes,
        'Whole first server chunk must be durable before idle',
      );
      idle.durablePartialObservedAt = Date.now();
      idle.bytesDuringIdle = job.bytes;
      idleTimer = setTimeout(() => {
        idle.idleReleasedAt = Date.now();
        releaseIdle();
      }, idleMs);
    }
    if (!idle.durablePartialObservedAt)
      assert.ok(
        (job?.bytes ?? 0) <= firstChunkBytes,
        'Only initial bounded server prefix may arrive before idle',
      );
    if (idle.durablePartialObservedAt && !idle.idleReleasedAt) {
      assert.equal(
        job.state,
        'browser_downloading',
        'Live original reader expired during supported idle',
      );
      assert.equal(job.bytes, idle.bytesDuringIdle, 'Server emitted unexpected bytes during idle');
      if (!idleSamples.length || Date.now() - idleSamples.at(-1).at >= 5000)
        idleSamples.push({ at: Date.now(), state: job.state, bytes: job.bytes });
    }
    if (job?.state === 'complete') break;
    if (['failed', 'cancelled'].includes(job?.state))
      throw Error(JSON.stringify({ job, requests }));
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  assert.equal(
    job?.state,
    'complete',
    JSON.stringify({ jobState: job?.state, bytes: job?.bytes, idle, requests: requests.length }),
  );
  assert.ok(idle.idleReleasedAt - idle.durablePartialObservedAt >= 60000);
  assert.ok(idleSamples.some((sample) => sample.at - idle.durablePartialObservedAt >= 50000));
  idle.samples = idleSamples;
  assert.equal(allRequests.filter((request) => request.method === 'HEAD').length, 0);
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
    ...observations,
    diagnosticSourceChanges: false,
    originalResponseRequests: allRequests
      .filter((request) => request.path === '/one-use')
      .map((request) => ({ method: request.method })),
    nativeVerifiedSha256: job.verified_sha256,
    fixtureSha256: await binaryDigest(new URL(import.meta.url)),
    submissions: requests.length,
    sha256: digest(payload),
    ...run.result.value,
    limitations: [
      'Local fixtures; live hosts/accounts pending',
      'No stable/ESR Firefox or other OS qualification from this run',
      'Fixture manifest grants loopback optional permissions; runtime permission prompt is not qualified',
      'This run qualifies one original POST reader with a 60-second upstream idle; other lanes remain separate',
      'No global peak-memory bound is claimed by this fixture',
    ],
  };
  assert.equal(job.verified_sha256, digest(payload));
  assert.equal(await binaryDigest(new URL(import.meta.url)), initialDriverSha256, 'Driver changed during acceptance');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8',windowsHide:true}).trim(), sourceRevision, 'Source changed during acceptance');
  await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await writeFile(
    resolve(dir, 'failure.json'),
    JSON.stringify(
      {
        error: String(error),
        observations,
        requests: requests.map((item) => ({ method: item.method })),
        allRequests,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  releaseIdle();
  if (ws) {
    await command('Browser.close').catch(() => {});
    ws.close();
  }
  browserProc?.kill();
  daemon.kill();
  // Only the uniquely copied fixture executable is eligible, with PID/creation recheck.
  const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
  const cleanup =
    '$owned=Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq ' +
    quote(nativeBinary) +
    '}; foreach($saved in $owned){$current=Get-CimInstance Win32_Process -Filter ("ProcessId="+$saved.ProcessId); if($current.ExecutablePath -eq $saved.ExecutablePath -and $current.CreationDate -eq $saved.CreationDate){Stop-Process -Id $current.ProcessId -Force -ErrorAction SilentlyContinue}}';
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-EncodedCommand', Buffer.from(cleanup, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: 'ignore', timeout: 15000 },
  );
  daemon.stderr.destroy();
  daemon.unref();
  browserProc?.stderr.destroy();
  browserProc?.unref();
  server.closeAllConnections();
  server.close();
  // Remove only the unique fixture-created registration; user host registrations are never modified.
  execFileSync('reg', ['DELETE', registry, '/f'], { windowsHide: true, stdio: 'ignore' });
}
