// Real production worker/resolver with isolated native host and pregranted local fixture permissions.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { startSchedulerServer } from './installed-server.mjs';
import { qualifyQueuedCancellation } from './installed-queued-cancel.mjs';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url)),
  { build, stop } = require('esbuild');
const executable =
  process.env.NAV_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root = resolve('.fixture-streams', 'scheduler-installed-' + randomUUID()),
  extension = resolve(root, 'extension'),
  state = resolve(root, 'state'),
  output = resolve(root, 'output'),
  service = resolve(process.env.NAV_NATIVE_BINARY ?? 'target/debug/downloader-service.exe'),
  cli = resolve(process.env.NAV_CLI_BINARY ?? 'target/debug/downloader.exe');
const fixtureSource = await readFile(import.meta.filename),
  serverSource = await readFile('scripts/nav-fixtures/scheduler/installed-server.mjs');
await mkdir(extension, { recursive: true });
await mkdir(state, { recursive: true });
await mkdir(output, { recursive: true });
const fixture = await startSchedulerServer(),
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
    'chrome.storage.local.set({settings:{directCapture:true,locale:"en",disabledAdapters:[]}})',
  );
  await evaluate(optionsSession, 'chrome.runtime.sendMessage({type:"settings_changed"})');
  const snapshot = () =>
    evaluate(
      optionsSession,
      'chrome.runtime.sendMessage({type:"navigation_scheduler",request:{action:"snapshot"}})',
    );
  const settings = await snapshot();
  assert.equal(settings.settings.max_active, 3);
  const page = fixture.base + '/nav-adapters/gofile/wait?id=wait';
  const job = call('add', page, '--navigate', '--filename', 'scheduler.bin');
  await evaluate(
    optionsSession,
    'chrome.runtime.sendMessage(' +
      JSON.stringify({ type: 'continue_navigation', url: page }) +
      ')',
  );
  let waiting, alarms;
  for (let i = 0; i < 300; i++) {
    waiting = (await snapshot()).tasks.find((t) => t.id === job.id && t.status === 'waiting');
    if (waiting) {
      alarms = await evaluate(optionsSession, 'chrome.alarms.getAll()');
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(waiting, 'Production countdown did not create durable wait');
  assert.ok(
    alarms.some((a) => a.name.startsWith('navigation-wait-' + job.id + ':')),
    'Actual alarm missing',
  );
  console.log('Actual durable wait and alarm observed');
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(
    fixture.requests.filter((r) => r.path.endsWith('/submit')).length,
    0,
    'Elapsed local deadline submitted prematurely',
  );
  if (process.env.NAV_CANCEL_QUEUED === '1') {
    const rows = await qualifyQueuedCancellation({
      fixture,
      call,
      snapshot,
      evaluate,
      optionsSession,
      command,
      job,
      page,
      host,
    });
    const evidence = {
      fixture: 'installed-production-unadmitted-queue-cancel-v1',
      source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      browser: version.product,
      native_version: call('diagnostics').version,
      cli_version: execFileSync(cli, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
      native_build_revision: process.env.NAV_NATIVE_REVISION ?? null,
      native_binary_sha256: createHash('sha256')
        .update(await readFile(service))
        .digest('hex'),
      cli_binary_sha256: createHash('sha256')
        .update(await readFile(cli))
        .digest('hex'),
      fixture_sha256: createHash('sha256').update(fixtureSource).digest('hex'),
      queue_helper_sha256: createHash('sha256')
        .update(await readFile('scripts/nav-fixtures/scheduler/installed-queued-cancel.mjs'))
        .digest('hex'),
      production_background_sha256: createHash('sha256')
        .update(await readFile('apps/extension/src/background.ts'))
        .digest('hex'),
      production_cancel_sha256: createHash('sha256')
        .update(await readFile('apps/extension/src/navigation/scheduler/cancel.ts'))
        .digest('hex'),
      os: process.platform,
      arch: process.arch,
      rows,
      limits: [
        'Synthetic local queue with actual production extension/native messaging; pregranted loopback permissions',
        'No-owner and private-unclaimed kernel refusal and owner precedence have deterministic native tests; this installed row has existing scheduler authority',
        'Native desktop/window UI and unavailable platform matrix remain pending',
      ],
    };
    await writeFile(
      resolve(root, 'queued-cancellation-evidence.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    );
    await writeFile(
      'docs/evidence/nav-scheduling/installed-queued-cancellation.json',
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(JSON.stringify(evidence, null, 2));
  } else if (process.env.NAV_CANCEL_ONLY === '1') {
    const beforeTargets = (await command('Target.getTargets')).targetInfos;
    const ownedTab = beforeTargets.find((t) => t.type === 'page' && t.url === page);
    assert.ok(ownedTab);
    const userOrigin = await command('Target.createTarget', { url: page + '&retained-user-tab=1' });
    const legacy = await evaluate(
      optionsSession,
      'chrome.runtime.sendNativeMessage(' +
        JSON.stringify(host) +
        ',' +
        JSON.stringify({ version: 1, id: randomUUID(), command: 'cancel', args: { id: job.id } }) +
        ')',
    );
    assert.equal(legacy.ok, false);
    assert.match(legacy.error.message, /active session fence/);
    assert.notEqual(call('list').jobs.find((j) => j.id === job.id).state, 'cancelled');
    await evaluate(
      optionsSession,
      'chrome.runtime.sendMessage(' +
        JSON.stringify({ type: 'navigation_queue_cancel', id: job.id }) +
        ')',
    );
    await new Promise((r) => setTimeout(r, 2000));
    const cancelled = call('list').jobs.find((j) => j.id === job.id);
    assert.equal(cancelled.state, 'cancelled');
    const after = await snapshot();
    assert.ok(!after.tasks.some((t) => t.id === job.id && t.lease));
    const pendingAlarms = await evaluate(optionsSession, 'chrome.alarms.getAll()');
    assert.ok(!pendingAlarms.some((a) => a.name.startsWith('navigation-wait-' + job.id + ':')));
    const stored = await evaluate(optionsSession, 'chrome.storage.local.get(null)');
    assert.ok(!Object.hasOwn(stored, 'resolver-' + job.id));
    const remaining = (await command('Target.getTargets')).targetInfos;
    assert.ok(!remaining.some((t) => t.targetId === ownedTab.targetId));
    assert.ok(remaining.some((t) => t.targetId === userOrigin.targetId));
    assert.equal(fixture.requests.filter((r) => r.path.endsWith('/submit')).length, 0);
    const evidence = {
      fixture: 'installed-production-scoped-queue-cancel-v1',
      source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      browser: version.product,
      native_version: call('diagnostics').version,
      cli_version: execFileSync(cli, ['--version'], { windowsHide: true, encoding: 'utf8' }).trim(),
      checked_product_version: JSON.parse(await readFile('package.json', 'utf8')).version,
      native_build_revision: process.env.NAV_NATIVE_REVISION ?? null,
      native_binary_sha256: createHash('sha256')
        .update(await readFile(service))
        .digest('hex'),
      cli_binary_sha256: createHash('sha256')
        .update(await readFile(cli))
        .digest('hex'),
      fixture_sha256: createHash('sha256').update(fixtureSource).digest('hex'),
      production_background_sha256: createHash('sha256')
        .update(await readFile('apps/extension/src/background.ts'))
        .digest('hex'),
      production_cancel_sha256: createHash('sha256')
        .update(await readFile('apps/extension/src/navigation/scheduler/cancel.ts'))
        .digest('hex'),
      os: process.platform,
      arch: process.arch,
      rows: {
        state: cancelled.state,
        wait_alarm_removed: true,
        resolver_record_removed: true,
        reservation_released: true,
        owned_resolver_tab_closed: true,
        unrelated_user_tab_retained: true,
        original_submissions: 0,
        desktop_cancel_fallback: false,
        legacy_scoped_cancel_refused: true,
      },
      limits: [
        'Synthetic local wait page and pregranted permissions; production extension/native messaging except unique host address',
        'Trusted extension-page cancellation message; native desktop/window UI not exercised',
        'Retained same-site user tab has no task resolver record; private/native partial cancellation is covered separately by engine tests',
        'Unavailable browser/platform and live-account matrix remains pending',
      ],
    };
    await writeFile(
      resolve(root, 'cancellation-evidence.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    );
    await writeFile(
      'docs/evidence/nav-scheduling/installed-cancellation.json',
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    let workerRestart = null;
    if (process.env.NAV_WORKER_RESTART === '1') {
      const oldWorker = (await command('Target.getTargets')).targetInfos.find(
        (t) =>
          t.type === 'service_worker' &&
          t.url === 'chrome-extension://' + extensionId + '/background.js',
      );
      assert.ok(oldWorker);
      await command('ServiceWorker.enable', {}, optionsSession);
      await command('ServiceWorker.stopAllWorkers', {}, optionsSession);
      let stopped = false;
      for (let i = 0; i < 100; i++) {
        if (
          !(await command('Target.getTargets')).targetInfos.some(
            (t) => t.targetId === oldWorker.targetId,
          )
        ) {
          stopped = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(stopped, 'Worker target did not terminate');
      const recovered = await snapshot();
      const recoveredTask = recovered.tasks.find((t) => t.id === job.id);
      assert.equal(recoveredTask.wait.generation, waiting.wait.generation);
      assert.ok(recoveredTask.lease);
      const newWorker = (await command('Target.getTargets')).targetInfos.find(
        (t) =>
          t.type === 'service_worker' &&
          t.url === 'chrome-extension://' + extensionId + '/background.js',
      );
      assert.ok(newWorker);
      assert.notEqual(newWorker.targetId, oldWorker.targetId);
      const restoredAlarms = await evaluate(optionsSession, 'chrome.alarms.getAll()');
      assert.ok(restoredAlarms.some((a) => a.name.startsWith('navigation-wait-' + job.id + ':')));
      workerRestart = {
        terminated_old_target: true,
        replacement_target: true,
        preserved_wait_generation: true,
        preserved_lease: true,
        restored_alarm: true,
      };
      console.log('Installed actual worker restart preserved durable wait and alarm');
    }
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && !fixture.requests.some((r) => r.path.endsWith('/submit'))) {
      const targets = (await command('Target.getTargets')).targetInfos;
      const tab = targets.find((t) => t.type === 'page' && t.url === page);
      if (tab) {
        const session = await targetSession(tab.targetId);
        if (await click(session, null, 'radio')) await click(session, 'Continue');
        await command('Target.detachFromTarget', { sessionId: session });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const submits = fixture.requests.filter((r) => r.path.endsWith('/submit'));
    assert.equal(submits.length, 1);
    assert.equal(submits[0].ready, true);
    const queueRows = [];
    const queueRequest = (request) =>
      evaluate(
        optionsSession,
        'chrome.runtime.sendMessage(' +
          JSON.stringify({ type: 'navigation_scheduler', request }) +
          ')',
      );
    call('cancel', job.id);
    const port = new URL(fixture.base).port;
    for (let i = 0; i < 21; i++) {
      const url =
        'http://host' + i + '.scheduler.test:' + port + '/nav-adapters/gofile/wait?id=queue' + i;
      const added = call('add', url, '--navigate', '--filename', 'queue-' + i + '.bin');
      queueRows.push({ id: added.id, url });
    }
    await evaluate(
      optionsSession,
      'chrome.runtime.sendMessage(' +
        JSON.stringify({ type: 'continue_navigation', url: queueRows[0].url }) +
        ')',
    );
    async function activeCount(expected) {
      for (let i = 0; i < 300; i++) {
        const state = await snapshot();
        const active = state.tasks.filter((t) => queueRows.some((j) => j.id === t.id) && t.lease);
        if (active.length === expected) return state;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Actual queue cap ' + expected + ' missing ' + JSON.stringify(await snapshot()));
    }
    const resources = () =>
      JSON.parse(
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-File',
            'scripts/nav-fixtures/scheduler/installed-resources.ps1',
            '-BrowserPid',
            String(browserProc.pid),
          ],
          { windowsHide: true, encoding: 'utf8' },
        ),
      );
    const atThree = await activeCount(3),
      resourcesThree = resources();
    await queueRequest({ action: 'settings', max_active: 20, notifications: false });
    const atTwenty = await activeCount(20),
      resourcesTwenty = resources();
    let liveTabs = [];
    for (let i = 0; i < 300; i++) {
      liveTabs = await evaluate(optionsSession, 'chrome.tabs.query({})');
      if (liveTabs.filter((t) => t.url?.includes('.scheduler.test:')).length === 20) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(liveTabs.filter((t) => t.url?.includes('.scheduler.test:')).length, 20);
    const queuedRow = queueRows.find((j) => !atTwenty.tasks.find((t) => t.id === j.id)?.lease);
    await queueRequest({ action: 'control', id: queuedRow.id, paused: true, priority: null });
    const existing = queueRows.find((j) => atTwenty.tasks.find((t) => t.id === j.id)?.lease);
    const spare = queueRows.find(
      (j) => j.id !== existing.id && atTwenty.tasks.find((t) => t.id === j.id)?.lease,
    );
    call('cancel', spare.id);
    await activeCount(19);
    const sensitive = call(
      'add',
      existing.url + '&duplicate=1',
      '--navigate',
      '--filename',
      'serial.bin',
    );
    await evaluate(
      optionsSession,
      'chrome.runtime.sendMessage(' +
        JSON.stringify({ type: 'continue_navigation', url: existing.url + '&duplicate=1' }) +
        ')',
    );
    await new Promise((r) => setTimeout(r, 1000));
    const serial = await snapshot();
    assert.equal(serial.tasks.find((t) => t.id === sensitive.id).lease, null);
    assert.equal(serial.tasks.find((t) => t.id === sensitive.id).reason, 'host_session_busy');
    await queueRequest({ action: 'settings', max_active: 3, notifications: false });
    const lowered = await snapshot();
    assert.equal(
      lowered.tasks.filter((t) => queueRows.some((j) => j.id === t.id) && t.lease).length,
      19,
    );
    for (const row of [...queueRows, { id: sensitive.id }]) call('cancel', row.id);
    console.log('Installed actual admission limits 3/20 and sensitive host serialization verified');
    const evidence = {
      fixture: 'installed-production-scheduler-readiness-v1',
      source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      browser: version.product,
      native_binary_sha256: createHash('sha256')
        .update(await readFile(service))
        .digest('hex'),
      native_version: call('diagnostics').version,
      native_build_revision: process.env.NAV_NATIVE_REVISION ?? null,
      fixture_sha256: createHash('sha256').update(fixtureSource).digest('hex'),
      server_sha256: createHash('sha256').update(serverSource).digest('hex'),
      production_source_sha256: createHash('sha256')
        .update(await readFile('apps/extension/src/background.ts'))
        .digest('hex'),
      os: process.platform,
      arch: process.arch,
      default_limit: 3,
      configured_limit: 20,
      resources: [
        { active: 3, ...resourcesThree },
        { active: 20, ...resourcesTwenty },
      ],
      installed_queue: {
        default_leases: 3,
        configured_leases: 20,
        actual_owned_tabs: 20,
        lowered_limit_preserves_leases: 19,
        sensitive_second_lease: false,
        sensitive_block_reason: 'host_session_busy',
        free_global_slot_during_sensitive_check: true,
      },
      wait: {
        status: waiting.status,
        generation: waiting.wait.generation,
        source_generation: waiting.generation,
        observed_duration_ms: waiting.wait.observed_duration_ms,
      },
      actual_alarm: true,
      worker_restart: workerRestart,
      server_hold_ms: 45000,
      submissions: submits.map((r) => ({ method: r.method, ready: r.ready })),
      premature_submissions: 0,
      limits: [
        'Synthetic local pages; production worker/resolver/native messaging unchanged except unique host address',
        'Pregranted loopback permissions; trusted preview control selected by CDP input',
        'Installed extension queue cancel rejects missing scope fence; desktop CLI cancels fixture jobs',
        'Retry-After ingestion, whole-browser restart/sleep and unavailable OS remain pending; resource measurements are samples not memory-bound proofs',
      ],
    };
    await mkdir('docs/evidence/nav-scheduling', { recursive: true });
    await writeFile(resolve(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    await writeFile(
      'docs/evidence/nav-scheduling/installed-readiness.json',
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(JSON.stringify(evidence, null, 2));
  }
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
