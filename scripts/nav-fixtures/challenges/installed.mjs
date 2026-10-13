// Real production worker/resolver with isolated native host and pregranted local fixture permissions.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { startChallengeServer, expectedHash } from './server.mjs';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url)),
  { build } = require('esbuild');
const executable =
  process.env.NAV_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root = resolve('.fixture-challenges', 'installed-' + randomUUID()),
  extension = resolve(root, 'extension'),
  state = resolve(root, 'state'),
  output = resolve(root, 'output'),
  service = resolve('target/debug/downloader-service.exe'),
  cli = resolve('target/debug/downloader.exe');
await mkdir(extension, { recursive: true });
await mkdir(state, { recursive: true });
await mkdir(output, { recursive: true });
const fixture = await startChallengeServer(),
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
  for (const provider of ['g4u', 'ddownload', 'rapidgator', 'gofile']) {
    const page = fixture.base + '/nav-challenges/' + provider + '/page';
    const job = call(
      'add',
      page,
      '--navigate',
      '--filename',
      provider + '-intended.bin',
      '--sha256',
      expectedHash,
    );
    await evaluate(
      optionsSession,
      'chrome.runtime.sendMessage(' +
        JSON.stringify({ type: 'continue_navigation', url: page }) +
        ')',
    );
    let tab;
    for (let i = 0; i < 200; i++) {
      const targets = await command('Target.getTargets');
      tab = targets.targetInfos.find((t) => t.type === 'page' && t.url === page);
      if (tab) break;
      if (i > 0 && i % 50 === 0)
        await evaluate(
          optionsSession,
          'chrome.runtime.sendMessage(' +
            JSON.stringify({ type: 'continue_navigation', url: page }) +
            ')',
        );
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!tab)
      throw Error(
        'Owned navigation tab missing: ' +
          JSON.stringify({
            targets: (await command('Target.getTargets')).targetInfos.map((t) => ({
              type: t.type,
              url: t.url,
            })),
            snapshot: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"snapshot"})',
            ),
            diagnostics: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"diagnostics"})',
            ),
          }),
      );
    const session = await targetSession(tab.targetId);
    await command('Runtime.enable', {}, session);
    await waitClick(session, 'Use this file host: gofile.io');
    await waitClick(session, 'Solve locally');
    console.log('Local solve invoked for ' + provider);
    await command('Target.detachFromTarget', { sessionId: session });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const urls = (await command('Target.getTargets')).targetInfos;
      if (urls.find((t) => t.targetId === tab.targetId)?.url.endsWith('/submit')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log('Form result ', JSON.stringify(fixture.submits));
    await evaluate(
      optionsSession,
      'chrome.runtime.sendMessage(' +
        JSON.stringify({ type: 'navigation_queue_continue', id: job.id }) +
        ')',
    );
    const currentTreeSession = await targetSession(tab.targetId);
    const tree = (await command('Accessibility.getFullAXTree', {}, currentTreeSession)).nodes;
    await waitClick(currentTreeSession, null, 'radio');
    const controls = (await command('Accessibility.getFullAXTree', {}, currentTreeSession)).nodes;
    const continueNode = controls.find(
      (n) => !n.ignored && n.role?.value === 'button' && n.name?.value === 'Continue',
    );
    if (!continueNode?.backendDOMNodeId) throw Error('Continue control missing');
    const resolved = await command(
      'DOM.resolveNode',
      { backendNodeId: continueNode.backendDOMNodeId },
      currentTreeSession,
    );
    await command(
      'Runtime.callFunctionOn',
      {
        objectId: resolved.object.objectId,
        functionDeclaration: 'function(){setTimeout(()=>this.click(),500);return true}',
        returnByValue: true,
      },
      currentTreeSession,
    );
    await command('Target.detachFromTarget', { sessionId: currentTreeSession });
    assert(
      fixture.submits.some((s) => s.provider === provider && s.accepted),
      'Original challenge form did not submit: ' +
        JSON.stringify(
          tree.filter((n) => !n.ignored && n.role?.value === 'status').map((n) => n.name?.value),
        ),
    );

    let complete;
    const completionDeadline = Date.now() + 60000;
    while (Date.now() < completionDeadline) {
      const current = call('list').jobs.find((j) => j.id === job.id);
      if (current?.state === 'complete') {
        complete = current;
        break;
      }
      if (current?.state === 'failed') throw Error(current.error);
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!complete)
      throw Error(
        'Production worker/native completion missing for ' +
          provider +
          ': ' +
          JSON.stringify({
            diagnostics: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"diagnostics"})',
            ),
            settings: await evaluate(optionsSession, 'chrome.storage.local.get("settings")'),
            capture: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"capture_status"})',
            ),
            jobs: call('list').jobs.map((j) => ({
              state: j.state,
              error: j.error,
              nav: j.navigation_url,
            })),
            snapshot: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"snapshot"})',
            ),
          }),
      );
    assert(complete.destination.startsWith(output));
    const bytes = await readFile(complete.destination);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
    assert.equal(complete.page_url, page);
    assert.equal(complete.selected_host, 'gofile.io');
    rows.push({
      provider,
      selected_host: complete.selected_host,
      bytes: bytes.length,
      sha256: expectedHash,
      state: complete.state,
      claim_generation: complete.navigation_scope.claim_generation,
      source_generation: complete.source_generation,
    });
    console.log('Verified production challenge ' + provider);
  }
  assert.equal(fixture.submits.filter((s) => s.accepted).length, 4);
  const evidence = {
    fixture: 'production-installed-challenges-v1',
    browser: version.product,
    os: process.platform,
    arch: process.arch,
    native_version: call('diagnostics').version,
    native_binary_sha256: createHash('sha256')
      .update(await readFile(service))
      .digest('hex'),
    diagnostic_source_changes: false,
    rows,
    accepted_original_submissions: 4,
    paid_calls: 0,
    limits: [
      'Synthetic open-circle protocol only; live providers/accounts and paid provider pending',
      'Pregranted loopback permissions and unique fixture native host name; production worker/resolver/modules otherwise unchanged',
      'Host choice, local solve and radio use AX/Input. Final actual Continue element click is scheduled 500ms after driver detachment, preserving exclusive production debugger ownership; no response bytes travel through CDP',
      'The trusted extension Continue action resumes the fresh HTML page before preview; native desktop window and unavailable browser/platform matrix remain pending',
    ],
  };
  await writeFile(resolve(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await writeFile('.local/nav-challenges/installed-result.json', JSON.stringify(evidence, null, 2));
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
}
