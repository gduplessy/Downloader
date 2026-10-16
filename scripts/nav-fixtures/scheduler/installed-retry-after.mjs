// Real production worker/resolver with isolated native host and pregranted local fixture permissions.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { startRetryAfterServer } from './retry-after-server.mjs';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url)),
  { build, stop } = require('esbuild');
const executable =
  process.env.NAV_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root = resolve('.fixture-streams', 'retry-after-installed-' + randomUUID()),
  extension = resolve(root, 'extension'),
  state = resolve(root, 'state'),
  output = resolve(root, 'output'),
  service = resolve(process.env.NAV_NATIVE_BINARY ?? 'target/debug/downloader-service.exe'),
  cli = resolve(process.env.NAV_CLI_BINARY ?? 'target/debug/downloader.exe');
const fixtureSource = await readFile(import.meta.filename),
  serverSource = await readFile('scripts/nav-fixtures/scheduler/retry-after-server.mjs');
await mkdir(extension, { recursive: true });
await mkdir(state, { recursive: true });
await mkdir(output, { recursive: true });
const fixture = await startRetryAfterServer(),
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
      'webNavigation',
      'scripting',
      'tabs',
      'notifications',
    ],
    host_permissions: ['http://127.0.0.1/*', 'http://*.scheduler.test/*'],
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
      '--host-resolver-rules=MAP *.scheduler.test 127.0.0.1',
      '--no-proxy-server',
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
    'chrome.storage.local.set({settings:{directCapture:false,locale:"en",disabledAdapters:[]}})',
  );
  await evaluate(optionsSession, 'chrome.runtime.sendMessage({type:"settings_changed"})');
  const snapshot = () =>
    evaluate(
      optionsSession,
      'chrome.runtime.sendMessage({type:"navigation_scheduler",request:{action:"snapshot"}})',
    );
  const results = [];
  await evaluate(
    optionsSession,
    `globalThis.retryCommits=[]; chrome.webNavigation.onCommitted.addListener(d=>{if(d.frameId===0)globalThis.retryCommits.push({tabId:d.tabId,documentId:d.documentId});}); globalThis.retryHeaders=[]; chrome.webRequest.onHeadersReceived.addListener(d=>{if(d.type==='main_frame'&&[429,503].includes(d.statusCode))globalThis.retryHeaders.push({requestId:d.requestId,documentId:d.documentId,tabId:d.tabId,status:d.statusCode});},{urls:['http://*/*']},['responseHeaders']);`,
  );
  for (const name of (
    process.env.NAV_RETRY_CASES ?? 'numeric,date,repeated,malformed,oversized'
  ).split(',')) {
    const initialResponse = process.env.NAV_RETRY_INITIAL === '1';
    const page =
      fixture.base +
      '/nav-adapters/gofile/' +
      (initialResponse ? 'limited' : 'start') +
      '?case=' +
      name;
    const limited = fixture.base + '/nav-adapters/gofile/limited?case=' + name;
    const job = call('add', page, '--navigate', '--filename', 'retry-' + name + '.bin');
    await evaluate(
      optionsSession,
      'chrome.runtime.sendMessage(' +
        JSON.stringify({ type: 'continue_navigation', url: page }) +
        ')',
    );
    let observed,
      originalWait,
      replacement = false,
      oldWorkerId,
      extendedNavigation = false;
    const deadline = Date.now() + 90000;
    while (
      Date.now() < deadline &&
      !fixture.requests.some((r) => r.name === name && r.path.endsWith('/submit'))
    ) {
      const state = await snapshot(),
        task = state.tasks.find((t) => t.id === job.id);
      if (task?.wait?.basis === 'server') {
        originalWait ??= structuredClone(task.wait);
        if (name === 'extended') {
          if (observed) assert.ok(task.wait.deadline_ms >= observed.deadline_ms);
          observed = structuredClone(task.wait);
          if (!extendedNavigation) {
            const target = (await command('Target.getTargets')).targetInfos.find(
              (t) => t.type === 'page' && t.url === limited,
            );
            assert.ok(target);
            const session = await targetSession(target.targetId);
            await command('Page.navigate', { url: limited + '&extension=1' }, session);
            await command('Target.detachFromTarget', { sessionId: session });
            extendedNavigation = true;
            continue;
          }
        } else {
          observed ??= structuredClone(task.wait);
          assert.equal(
            task.wait.deadline_ms,
            observed.deadline_ms,
            'Repeated/DOM observations extended the server deadline',
          );
          assert.equal(task.wait.generation, observed.generation);
        }
        if (name === 'repeated' && !replacement) {
          const old = (await command('Target.getTargets')).targetInfos.find(
            (t) =>
              t.type === 'service_worker' &&
              t.url === 'chrome-extension://' + extensionId + '/background.js',
          );
          assert.ok(old);
          oldWorkerId = old.targetId;
          await command('ServiceWorker.enable', {}, optionsSession);
          await command('ServiceWorker.stopAllWorkers', {}, optionsSession);
          for (let i = 0; i < 100; i++) {
            if (
              !(await command('Target.getTargets')).targetInfos.some(
                (t) => t.targetId === oldWorkerId,
              )
            )
              break;
            if (i === 99) throw Error('Actual worker did not stop');
            await new Promise((r) => setTimeout(r, 100));
          }
          const restored = (await snapshot()).tasks.find((t) => t.id === job.id);
          assert.equal(restored.wait.deadline_ms, observed.deadline_ms);
          assert.equal(restored.wait.generation, observed.generation);
          const current = (await command('Target.getTargets')).targetInfos.find(
            (t) =>
              t.type === 'service_worker' &&
              t.url === 'chrome-extension://' + extensionId + '/background.js',
          );
          assert.ok(current && current.targetId !== oldWorkerId);
          replacement = true;
        }
      }
      const targets = (await command('Target.getTargets')).targetInfos;
      const target = targets.find(
        (t) =>
          t.type === 'page' &&
          (t.url === page || t.url === limited || t.url === limited + '&extension=1'),
      );
      if (target) {
        const session = await targetSession(target.targetId);
        if (await click(session, null, 'radio')) await click(session, 'Continue');
        await command('Target.detachFromTarget', { sessionId: session });
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const posts = fixture.requests.filter((r) => r.name === name && r.path.endsWith('/submit'));
    const headers = await evaluate(optionsSession, 'globalThis.retryHeaders');
    assert.equal(posts[0]?.method, 'POST', 'The final original request must be POST');
    assert.equal(
      fixture.requests.filter((r) => r.name === name && r.method === 'HEAD').length,
      0,
      'No HEAD probe',
    );
    assert.equal(
      posts.length,
      1,
      'Exactly one original POST is required: ' +
        JSON.stringify({
          name,
          observed,
          headers,
          requests: fixture.requests.filter((r) => r.name === name),
        }),
    );
    assert.equal(
      posts[0].ready,
      true,
      'Early POST: ' +
        JSON.stringify({
          observed,
          headers,
          rows: await evaluate(
            optionsSession,
            "chrome.storage.local.get(null).then(s=>Object.fromEntries(Object.entries(s).filter(([k])=>k.startsWith('resolver-')||k.startsWith('server-response-'))))",
          ),
        }),
    );
    assert.equal(
      fixture.requests.filter((r) => r.name === name && r.path.endsWith('/limited')).length,
      name === 'extended' ? 2 : 1,
      'No navigation replay',
    );
    if (['numeric', 'date', 'repeated', 'extended'].includes(name))
      assert.ok(observed, 'No actual Retry-After ingestion: ' + JSON.stringify(headers));
    else
      assert.equal(
        observed,
        undefined,
        'Malformed/oversized headers must not establish server authority',
      );
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(
      fixture.requests.filter((r) => r.name === name && r.path.endsWith('/submit')).length,
      1,
      'No duplicate original POST',
    );
    if (name === 'extended') {
      assert.ok(extendedNavigation && observed.deadline_ms > originalWait.deadline_ms);
      assert.ok(observed.generation > originalWait.generation);
    }
    results.push({
      name,
      initial_response: initialResponse,
      original_wait: originalWait ?? null,
      distinct_owned_navigation: extendedNavigation,
      wait: observed ?? null,
      server_deadline: fixture.cases.get(name).readyAt,
      original_posts: 1,
      original_method: posts[0].method,
      head_probes: 0,
      early_posts: 0,
      duplicate_posts: 0,
      navigation_gets: name === 'extended' ? 2 : 1,
      worker_replaced: replacement,
      headers_include_document_id: headers.every((h) => !!h.documentId),
      committed_document_ids_present: (
        await evaluate(optionsSession, 'globalThis.retryCommits')
      ).every((c) => !!c.documentId),
    });
    await evaluate(
      optionsSession,
      'chrome.runtime.sendMessage(' +
        JSON.stringify({ type: 'navigation_queue_cancel', id: job.id }) +
        ')',
    );
    console.log('Qualified Retry-After ' + name);
  }
  const evidence = {
    fixture: 'installed-production-retry-after-v1',
    source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    browser: version.product,
    native_version: call('diagnostics').version,
    native_build_revision: process.env.NAV_NATIVE_REVISION ?? null,
    native_binary_sha256: createHash('sha256')
      .update(await readFile(service))
      .digest('hex'),
    cli_binary_sha256: createHash('sha256')
      .update(await readFile(cli))
      .digest('hex'),
    fixture_sha256: createHash('sha256').update(fixtureSource).digest('hex'),
    server_sha256: createHash('sha256').update(serverSource).digest('hex'),
    production_background_sha256: createHash('sha256')
      .update(await readFile('apps/extension/src/background.ts'))
      .digest('hex'),
    os: process.platform,
    arch: process.arch,
    results,
    limits: [
      process.env.NAV_RETRY_INITIAL === '1'
        ? 'Synthetic original initial429/503; task-created tab receipt and post-load native scope; pregranted permissions; direct capture off'
        : 'Synthetic owned landing then original user-selected main-frame429/503; pregranted permissions; direct capture off',
      'Firefox/other OS/live providers/private installed matrix remain separately pending; initial-response acceptance is limited to explicitly recorded initial rows',
      'Readiness HTML acknowledgement, not file-transfer proof',
    ],
  };
  await writeFile(
    resolve(root, 'retry-after-evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  await writeFile(
    'docs/evidence/nav-scheduling/retry-after-' +
      (version.product.startsWith('Edg/') ? 'edge' : 'chrome') +
      (process.env.NAV_RETRY_INITIAL === '1' ? '-initial' : '') +
      '.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(evidence, null, 2));
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
  stop();
}
