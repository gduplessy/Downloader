import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID, generateKeyPairSync } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const esbuild = require('esbuild');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashFile = async (path) => digest(await readFile(path));
const driverSha256 = await hashFile(import.meta.filename);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const root = resolve('.fixture-streams', 'solver-controls-' + randomUUID());
const extension = resolve(root, 'extension'),
  state = resolve(root, 'state');
await mkdir(extension, { recursive: true });
await mkdir(state, { recursive: true });
const pair =
  process.env.NAV_NATIVE_PAIR ??
  'C:/Users/gduplessy/code/Downloader/.fixture-streams/native-pairs/3b808ae-0.25.1';
const hashes = {
  'downloader-service.exe': '3cbd6aa2c7d65e2c4aeaabd83afed64d86e838d2c898fd8f63cb1083804056f2',
  'downloader.exe': '43094f64f3379c39cd24c0e3358df77d0931afa9dd81a80a9550d16e57787e0c',
};
for (const [name, hash] of Object.entries(hashes)) {
  assert.equal(await hashFile(resolve(pair, name)), hash);
  await copyFile(resolve(pair, name), resolve(root, name));
  assert.equal(await hashFile(resolve(root, name)), hash);
}
const service = resolve(root, 'downloader-service.exe'),
  cli = resolve(root, 'downloader.exe');
const host = 'org.downloader.fixture_' + randomUUID().replaceAll('-', '');
const key = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .publicKey.export({ type: 'spki', format: 'der' })
  .toString('base64');
let extensionId = [
  ...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16),
]
  .map((n) => String.fromCharCode(97 + (n >> 4), 97 + (n & 15)))
  .join('');
const built = await esbuild.build({
  entryPoints: ['background', 'resolver', 'discovery', 'content', 'popup'].map(
    (n) => 'apps/extension/src/' + n + '.ts',
  ),
  outdir: extension,
  bundle: true,
  metafile: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: JSON.stringify('chromium') },
  plugins: [
    {
      name: 'isolated-native-address',
      setup(builder) {
        builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
          contents: (await readFile(path, 'utf8')).replaceAll('org.downloader.native', host),
          loader: 'ts',
        }));
      },
    },
  ],
});
const sourceHashes = Object.fromEntries(
  await Promise.all(
    Object.keys(built.metafile.inputs)
      .filter((p) => !p.replaceAll('\\', '/').includes('node_modules/'))
      .map(async (p) => [p.replaceAll('\\', '/'), await hashFile(p)]),
  ),
);
await copyFile('apps/extension/public/popup.html', resolve(extension, 'popup.html'));
await copyFile('apps/extension/public/style.css', resolve(extension, 'style.css'));
await writeFile(
  resolve(extension, 'options.html'),
  '<!doctype html><title>Isolated solver controls driver</title>',
);
await writeFile(
  resolve(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    key,
    name: 'Downloader installed solver controls fixture',
    version: '0.1.0',
    permissions: [
      'nativeMessaging',
      'storage',
      'cookies',
      'tabs',
      'scripting',
      'webRequest',
      'webNavigation',
      'downloads',
      'contextMenus',
      'alarms',
      'debugger',
    ],
    host_permissions: ['http://127.0.0.1/*'],
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html' },
    options_ui: { page: 'options.html', open_in_tab: true },
  }),
);
const nativeManifest = resolve(root, 'native.json');
async function registration() {
  await writeFile(
    nativeManifest,
    JSON.stringify({
      name: host,
      description: 'Isolated production solver controls',
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
const executable =
  process.env.NAV_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const registry =
  (/msedge/i.test(executable)
    ? 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\'
    : 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\') + host;
const env = { ...process.env, DOWNLOADER_DATA_DIR: state };
function call(...args) {
  return JSON.parse(
    execFileSync(cli, ['--json', ...args], {
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, label, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(100);
  }
  throw Error(label + ' timed out');
}
const payload = Buffer.from('Permitted local solver UI transfer\n'.repeat(8192));
const sessionEvents = [];
const seenSessions = new Set();
const sessions = new Set(),
  commands = [],
  fileRequests = [];
let requestsToSolver = 0;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/v1' && req.method === 'POST') {
      let text = '';
      for await (const b of req) {
        text += b;
        if (text.length > 32768) throw Error('Oversized request');
      }
      const body = JSON.parse(text);
      commands.push(body.cmd);
      let reply = { status: 'ok' };
      if (body.cmd === 'sessions.create') {
        assert.equal(typeof body.session, 'string');
        assert.ok(body.session.length > 0 && !seenSessions.has(body.session), 'Session must be unique');
        seenSessions.add(body.session);
        sessionEvents.push({ command: body.cmd, sessionSha256: digest(body.session) });
        sessions.add(body.session);
        reply.session = body.session;
      } else if (body.cmd === 'sessions.destroy') {
        assert.ok(sessions.has(body.session), 'Destroy requires owned active session');
        sessionEvents.push({ command: body.cmd, sessionSha256: digest(body.session) });
        sessions.delete(body.session);
      }
      else if (body.cmd === 'sessions.list') reply.sessions = [...sessions];
      else if (body.cmd === 'request.get') {
        assert.ok(sessions.has(body.session), 'Request requires owned active session');
        sessionEvents.push({ command: body.cmd, sessionSha256: digest(body.session) });
        requestsToSolver++;
        reply.solution = {
          status: 200,
          url: base + '/page',
          response:
            requestsToSolver === 1
              ? '<html><img id="captchaImage" alt="Unsolved custom challenge"></html>'
              : '<html><a download href="' + base + '/file.bin">Download</a></html>',
          userAgent: 'PermittedSolverFixture/1.0',
          cookies: [
            {
              name: 'fixture_clearance',
              value: 'local-only',
              domain: '127.0.0.1',
              path: '/',
              secure: false,
            },
          ],
        };
      } else throw Error('Unexpected solver command');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply));
      return;
    }
    if (req.url === '/file.bin') {
      const validSession =
        req.headers.cookie?.includes('fixture_clearance=local-only') === true &&
        req.headers['user-agent'] === 'PermittedSolverFixture/1.0';
      fileRequests.push({ method: req.method, validSession, range: !!req.headers.range });
      if (!validSession) {
        res.writeHead(403);
        res.end();
        return;
      }
      const match = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),
        start = match ? Number(match[1]) : 0,
        end =
          match && match[2] ? Math.min(Number(match[2]), payload.length - 1) : payload.length - 1;
      assert(start <= end && end < payload.length);
      const headers = {
        'Content-Type': 'application/octet-stream',
        'Content-Length': end - start + 1,
        'Content-Disposition': 'attachment; filename=solver-ui.bin',
        'Accept-Ranges': 'bytes',
        ETag: '"solver-ui-v1"',
      };
      if (match) headers['Content-Range'] = `bytes ${start}-${end}/${payload.length}`;
      res.writeHead(match ? 206 : 200, headers);
      res.end(req.method === 'HEAD' ? undefined : payload.subarray(start, end + 1));
      return;
    }
    if (req.url === '/') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ msg: 'FlareSolverr is ready!', version: 'fixture-health-only' }));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><title>Manual hosted page</title><h1>Use the browser or local solver</h1>',
    );
  } catch {
    res.writeHead(500);
    res.end('Fixture request failed');
  }
});
let daemon,
  browserProc,
  ws,
  seq = 0,
  registered = false,
  stage = 'startup';
const pending = new Map();
let base;
function command(method, params = {}, sessionId) {
  return new Promise((resolveResult, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + ' timed out'));
    }, 30000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolveResult(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(sessionId, expression) {
  const r = await command(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (r.exceptionDetails) throw Error('Browser evaluation failed: ' + r.exceptionDetails.text);
  return r.result?.value;
}
async function attach(targetId) {
  return (await command('Target.attachToTarget', { targetId, flatten: true })).sessionId;
}
async function actualClick(sessionId, id) {
  const node = (await command('DOM.getDocument', {}, sessionId)).root;
  const selected = await command(
    'DOM.querySelector',
    { nodeId: node.nodeId, selector: '#' + id },
    sessionId,
  );
  assert(selected.nodeId, 'Actual control missing: ' + id);
  const model = (await command('DOM.getBoxModel', { nodeId: selected.nodeId }, sessionId)).model;
  const q = model.border,
    x = (q[0] + q[2] + q[4] + q[6]) / 4,
    y = (q[1] + q[3] + q[5] + q[7]) / 4;
  for (const type of ['mousePressed', 'mouseReleased'])
    await command(
      'Input.dispatchMouseEvent',
      { type, x, y, button: 'left', clickCount: 1 },
      sessionId,
    );
}
let settings, driverSession, jobId, browserVersion;
const observations = [];
async function saveSettings() {
  await writeFile(resolve(root, 'settings.json'), JSON.stringify(settings));
  call('set', resolve(root, 'settings.json'));
}
async function popup() {
  const target = await command('Target.createTarget', {
    url: 'chrome-extension://' + extensionId + '/popup.html',
    newWindow: true,
  });
  const session = await attach(target.targetId);
  await until(
    () => evaluate(session, "document.getElementById('connection')?.classList.contains('good')"),
    'Production popup connection',
  );
  return { ...target, session };
}
async function closePopup(p) {
  await command('Target.closeTarget', { targetId: p.targetId }).catch(() => {});
}
try {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  daemon = spawn(service, ['daemon'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await until(() => {
    try {
      return call('settings');
    } catch {
      return null;
    }
  }, 'Isolated native service');
  const initial = call('settings');
  settings = initial.settings ?? initial;
  settings.directory = resolve(root, 'downloads');
  settings.categories = [];
  settings.solver.enabled = false;
  settings.solver.endpoint = base + '/';
  settings.network.proxy_mode = 'direct';
  settings.captcha.enabled = false;
  settings.captcha.external_opt_in = false;
  settings.captcha.total_budget_microusd = 0;
  await saveSettings();
  execFileSync('reg', ['ADD', registry, '/ve', '/t', 'REG_SZ', '/d', nativeManifest, '/f'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  registered = true;
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
    { env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] },
  );
  const endpoint = await until(async () => {
    try {
      const lines = (await readFile(resolve(root, 'profile', 'DevToolsActivePort'), 'utf8'))
        .trim()
        .split(/\r?\n/);
      return 'ws://127.0.0.1:' + lines[0] + lines[1];
    } catch {
      return null;
    }
  }, 'Fixture browser');
  ws = new WebSocket(endpoint);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  ws.onmessage = ({ data }) => {
    const r = JSON.parse(data);
    if (!r.id) return;
    const p = pending.get(r.id);
    pending.delete(r.id);
    r.error ? p?.reject(Error(r.error.message)) : p?.resolve(r.result);
  };
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(Error('Fixture browser closed'));
    pending.clear();
  };
  browserVersion = (await command('Browser.getVersion')).product;
  const loaded = await command('Extensions.loadUnpacked', { path: extension });
  if (loaded.id && loaded.id !== extensionId) {
    extensionId = loaded.id;
    await registration();
  }
  const driver = await command('Target.createTarget', {
    url: 'chrome-extension://' + extensionId + '/options.html',
  });
  driverSession = await attach(driver.targetId);
  await until(
    () => evaluate(driverSession, 'typeof chrome.runtime?.sendMessage==="function"'),
    'Extension driver',
  );
  await evaluate(
    driverSession,
    'chrome.storage.local.set({settings:{automatic:false,directCapture:false,extensions:[],excluded:[],bypassUntil:0,locale:"en",overlay:false}})',
  );
  await evaluate(driverSession, 'chrome.runtime.sendMessage({type:"settings_changed"})');
  const added = call('add', base + '/page', '--navigate', '--filename', 'solver-ui.bin');
  jobId = (added.job ?? added).id;
  assert(jobId);
  const pendingPopup = await popup();
  assert.equal(
    await evaluate(pendingPopup.session, "document.getElementById('try-solver').disabled"),
    true,
  );
  assert.equal(
    await evaluate(pendingPopup.session, "document.getElementById('continue-navigation').disabled"),
    false,
  );
  stage = 'continue';
  await actualClick(pendingPopup.session, 'continue-navigation');
  await until(() => {
    const j = call('list').jobs.find((j) => j.id === jobId);
    return j.navigation_scope && j.state === 'waiting_user';
  }, 'Actual Continue navigation');
  assert.equal(requestsToSolver, 0);
  observations.push({ case: 'actual-continue-with-solver-disabled', solverCalls: 0 });
  settings.solver.enabled = true;
  settings.network.proxy_mode = 'system';
  await saveSettings();
  const routed = await popup();
  assert.equal(
    await evaluate(routed.session, "document.getElementById('try-solver').disabled"),
    true,
  );
  await closePopup(routed);
  observations.push({ case: 'non-direct-routing-disabled', solverCalls: 0 });
  settings.network.proxy_mode = 'direct';
  await saveSettings();
  const stale = await popup();
  assert.equal(
    await evaluate(stale.session, "document.getElementById('try-solver').disabled"),
    false,
  );
  settings.solver.enabled = false;
  await saveSettings();
  stage = 'stale-settings';
  await actualClick(stale.session, 'try-solver');
  await until(
    () =>
      evaluate(
        stale.session,
        "document.getElementById('error').textContent.includes('solver_disabled')",
      ),
    'Stale setting refusal',
  );
  assert.equal(requestsToSolver, 0);
  await closePopup(stale);
  observations.push({ case: 'stale-enabled-button-refused', solverCalls: 0 });
  settings.solver.enabled = true;
  await saveSettings();
  const first = await popup();
  stage = 'manual-refusal';
  await actualClick(first.session, 'try-solver');
  await until(() => {
    const j = call('list').jobs.find((j) => j.id === jobId);
    return (
      requestsToSolver === 1 && j.state === 'waiting_user' && j.solver_outcome === 'solver_captcha'
    );
  }, 'Typed custom CAPTCHA refusal');
  assert.equal(sessions.size, 0);
  assert.equal(fileRequests.length, 0);
  observations.push({
    case: 'unsupported-custom-captcha',
    outcome: 'solver_captcha',
    fileRequests: 0,
  });
  const retry = await popup();
  assert.equal(
    await evaluate(retry.session, "document.getElementById('try-solver').disabled"),
    false,
  );
  stage = 'manual-retry';
  await actualClick(retry.session, 'try-solver');
  const completed = await until(() => {
    const j = call('list').jobs.find((j) => j.id === jobId);
    if (j.state === 'failed') throw Error('Solver transfer failed');
    return j.state === 'complete' ? j : null;
  }, 'Manual solver retry file hash');
  const bytes = await readFile(completed.destination);
  assert.equal(digest(bytes), digest(payload));
  assert.equal(requestsToSolver, 2);
  assert.equal(sessions.size, 0);
  assert(fileRequests.length > 0 && fileRequests.every((r) => r.validSession));
  assert.equal(commands.filter((c) => c === 'sessions.create').length, 2);
  assert.equal(commands.filter((c) => c === 'sessions.destroy').length, 2);
  for (const [name, hash] of Object.entries(hashes))
    assert.equal(await hashFile(resolve(root, name)), hash);
  observations.push({
    case: 'actual-manual-retry',
    state: completed.state,
    bytes: bytes.length,
    sha256: digest(bytes),
    solverRequests: 2,
    sessionsRemaining: 0,
  });
  assert.equal(seenSessions.size, 2);
  for (const session of seenSessions) {
    assert.deepEqual(sessionEvents.filter((e) => e.sessionSha256 === digest(session)).map((e) => e.command), ['sessions.create', 'request.get', 'sessions.destroy']);
  }
  assert.equal(await hashFile(import.meta.filename), driverSha256, 'Driver changed during run');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8', windowsHide:true}).trim(), revision, 'Revision changed during run');
  const evidence = {
    result: 'passed',
    fixture: 'installed-production-solver-popup-controls-v1',
    sourceRevision: revision,
    nativeBuildRevision: '3b808ae1967a210fc5b3a3e461488b9f2ab6cb61',
    nativeVersion: call('diagnostics').version,
    nativeHashes: hashes,
    browser: browserVersion,
    os: process.platform,
    arch: process.arch,
    driverSha256,
    sessionEvents,
    sourceHashes,
    bundleHashes: Object.fromEntries(
      await Promise.all(
        ['background', 'resolver', 'popup', 'discovery'].map(async (n) => [
          n + '.js',
          await hashFile(resolve(extension, n + '.js')),
        ]),
      ),
    ),
    observations,
    commands,
    fileRequests,
    limits: [
      'Actual production popup HTML/handler with trusted CDP pointer input in an installed extension page; native browser toolbar activation is not qualified',
      'Settings seeded through isolated CLI; installed native settings enable/save/test/disable controls remain pending',
      'Synthetic local FlareSolverr response is not real challenge clearance or live provider acceptance',
      'Pregranted loopback permissions, unique native host and isolated profiles; no private/otherOS/Firefox or paid-provider acceptance',
    ],
  };
  await writeFile(resolve(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await mkdir('.local/nav-solver', { recursive: true });
  await writeFile(
    '.local/nav-solver/installed-' + (/msedge/i.test(executable) ? 'edge' : 'chrome') + '.json',
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        result: 'passed',
        browser: browserVersion,
        evidence: resolve(root, 'evidence.json'),
        observations,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    resolve(root, 'failure.json'),
    JSON.stringify(
      { stage, error: String(error), sourceRevision: revision, driverSha256, sourceHashes, observations, commands, sessionEvents, fileRequests, requestsToSolver },
      null,
      2,
    ),
  );
  throw error;
} finally {
  try {
    if (ws?.readyState === WebSocket.OPEN) await command('Browser.close');
  } catch {}
  ws?.close();
  if (browserProc?.exitCode === null) browserProc.kill();
  try {
    if (daemon) call('quit');
  } catch {}
  if (daemon?.exitCode === null) daemon.kill();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  if (registered)
    try {
      execFileSync('reg', ['DELETE', registry, '/f'], { windowsHide: true, stdio: 'ignore' });
    } catch {}
  esbuild.stop();
}
