// Installed two-profile transfer fixture; CDP never relays response bytes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const browserExe =
  process.env.NAV_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root = resolve('.fixture-streams', 'transfer-' + Date.now());
const ext = resolve(root, 'extension'),
  data = resolve(root, 'service');
const host = 'org.downloader.fixture_' + randomUUID().replaceAll('-', '');
const nativeExe = resolve('target/debug/downloader-service.exe'),
  cliExe = resolve('target/debug/downloader.exe');
const desktopExe = resolve('target/debug/examples/navigation_transfer_fixture.exe');
const cookieName = 'fixture_session';
const markers = ['source-' + randomUUID(), 'recipient-' + randomUUID()];
const bytes = Number(process.env.NAV_BYTES || 262161);
assert.ok(Number.isSafeInteger(bytes) && bytes > 0 && bytes < 64 * 1024 * 1024);
const expected = [7, 113].map((seed) =>
  Buffer.from(Array.from({ length: bytes }, (_, i) => (i * 31 + seed) % 251)),
);
const expectedHashes = expected.map(hash),
  observations = {},
  browsers = [],
  originRequests = [];
let token,
  jobId,
  daemon,
  registration,
  phase = 'bootstrap';
const redact = (value) => {
  let text = String(value);
  for (const secret of [token, jobId, ...markers].filter(Boolean))
    text = text.replaceAll(secret, '<fixture-secret>');
  return text;
};
async function identity(path, label) {
  const info = await stat(path);
  return {
    workspaceRelativePath: label,
    sha256: hash(await readFile(path)),
    bytes: info.size,
    modifiedUtc: info.mtime.toISOString(),
  };
}
const executables = {
  hostAndDaemon: {
    ...(await identity(nativeExe, 'target/debug/downloader-service.exe')),
    sameExecutable: true,
    selfReportedVersion: null,
  },
  cli: {
    ...(await identity(cliExe, 'target/debug/downloader.exe')),
    selfReportedVersion: execFileSync(cliExe, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
  },
  desktopFixture: await identity(
    desktopExe,
    'target/debug/examples/navigation_transfer_fixture.exe',
  ),
};
await mkdir(ext, { recursive: true });
await mkdir(data, { recursive: true });
await writeFile(resolve(data, 'navigation-transfer-fixture-owned'), 'isolated qualification only');
const env = { ...process.env, DOWNLOADER_DATA_DIR: data };
const cli = (args) =>
  JSON.parse(
    execFileSync(cliExe, ['--json', ...args], {
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    }),
  );
const desktop = (command) =>
  JSON.parse(
    execFileSync(desktopExe, [], {
      env,
      input: JSON.stringify(command),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  );
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const extensionId = [
  ...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16),
]
  .map((n) => String.fromCharCode(97 + (n >> 4), 97 + (n & 15)))
  .join('');
await build({
  entryPoints: [
    'apps/extension/src/background.ts',
    'apps/extension/src/resolver.ts',
    'apps/extension/src/options.ts',
  ],
  outdir: ext,
  nodePaths: [resolve('apps/extension/node_modules')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: JSON.stringify('chromium') },
  plugins: [
    {
      name: 'isolated-native-registration',
      setup(builder) {
        builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
          contents: (await readFile(path, 'utf8')).replaceAll('org.downloader.native', host),
          loader: 'ts',
        }));
      },
    },
  ],
});
await copyFile('apps/extension/public/options.html', resolve(ext, 'options.html'));
await copyFile('apps/extension/public/style.css', resolve(ext, 'style.css'));
await writeFile(
  resolve(ext, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    key,
    name: 'Downloader isolated transfer qualification',
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
    options_page: 'options.html',
  }),
);
await writeFile(
  resolve(data, 'native-allowlist.json'),
  JSON.stringify({ chrome_ids: [extensionId], firefox_ids: [] }),
);
const manifest = resolve(root, 'native.json');
await writeFile(
  manifest,
  JSON.stringify({
    name: host,
    description: 'Isolated production transfer qualification',
    path: nativeExe,
    type: 'stdio',
    allowed_origins: ['chrome-extension://' + extensionId + '/'],
  }),
);
const server = createServer((req, res) => {
  const which = markers.findIndex((marker) =>
    (req.headers.cookie || '').includes(cookieName + '=' + marker),
  );
  originRequests.push({
    method: req.method,
    path: req.url.split('?')[0],
    cookieProfile: which === 0 ? 'source' : which === 1 ? 'recipient' : 'unrecognized',
    browser: /Chrome|Edg/.test(req.headers['user-agent'] || ''),
    phase,
  });
  if (req.url === '/nav-adapters/g4u/blob') {
    const seed = which === 0 ? 7 : which === 1 ? 113 : 19;
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><title>Session-specific original Blob</title><script>const bytes=new Uint8Array(' +
        bytes +
        ');for(let i=0;i<bytes.length;i++)bytes[i]=(i*31+' +
        seed +
        ')%251;const original=URL.createObjectURL(new Blob([bytes]));addEventListener("DOMContentLoaded",()=>{document.querySelector("a").href=original;window.fixtureSeed=' +
        seed +
        ';window.originalClicks=0;document.querySelector("a").addEventListener("click",()=>window.originalClicks++);});</script><a data-nav-fixture-control download="transferred.bin">Download original file</a>',
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const sourceUrl = 'http://127.0.0.1:' + server.address().port + '/nav-adapters/g4u/blob';
class Browser {
  constructor(name) {
    this.name = name;
    this.profile = resolve(root, name);
    this.seq = 0;
    this.waiters = new Map();
  }
  async command(method, params = {}, sessionId) {
    const id = ++this.seq;
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(Error(method + ' timed out'));
      }, 60000);
      this.waiters.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          done(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(sessionId, expression) {
    const reply = await this.command(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      sessionId,
    );
    if (reply.exceptionDetails)
      throw Error(
        redact(reply.exceptionDetails.text + ' ' + reply.exceptionDetails.exception?.description),
      );
    return reply.result?.value;
  }
  async launch() {
    this.process = spawn(
      browserExe,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        '--enable-unsafe-extension-debugging',
        '--user-data-dir=' + this.profile,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    this.process.stderr.on('data', () => {});
    let endpoint;
    for (let i = 0; i < 200; i++) {
      try {
        const lines = (await readFile(resolve(this.profile, 'DevToolsActivePort'), 'utf8'))
          .trim()
          .split(/\r?\n/);
        endpoint = 'ws://127.0.0.1:' + lines[0] + lines[1];
        break;
      } catch {}
      await pause(100);
    }
    assert.ok(endpoint, 'Isolated ' + this.name + ' browser did not start');
    this.socket = new WebSocket(endpoint);
    await new Promise((done, reject) => {
      this.socket.onopen = done;
      this.socket.onerror = reject;
    });
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const waiter = this.waiters.get(message.id);
      this.waiters.delete(message.id);
      message.error
        ? waiter?.reject(Error(message.error.message))
        : waiter?.resolve(message.result);
    };
    this.socket.onclose = () => {
      for (const waiter of this.waiters.values()) waiter.reject(Error('Fixture browser closed'));
      this.waiters.clear();
    };
    this.version = (await this.command('Browser.getVersion')).product;
    assert.equal(
      (await this.command('Extensions.loadUnpacked', { path: ext })).id,
      extensionId,
      'Actual extension identity differs',
    );
    const page = await this.command('Target.createTarget', {
      url: 'chrome-extension://' + extensionId + '/options.html',
    });
    this.optionsTarget = page.targetId;
    this.options = (
      await this.command('Target.attachToTarget', { targetId: page.targetId, flatten: true })
    ).sessionId;
    await waitFor(
      () =>
        this.evaluate(
          this.options,
          'Boolean(globalThis.chrome?.runtime?.id&&document.getElementById("navigation-transfer-code"))',
        ).catch(() => false),
      'Production receiver options did not mount',
    );
    assert.equal(await this.evaluate(this.options, 'chrome.runtime.id'), extensionId);
    assert.equal(await this.evaluate(this.options, 'chrome.extension.inIncognitoContext'), false);
    // Fixture permission/settings setup; actual receiver transfer UI is unchanged.
    await this.evaluate(
      this.options,
      'chrome.storage.local.set({settings:{automatic:false,directCapture:true,extensions:[],excluded:[],bypassUntil:0,locale:"en",overlay:false}})',
    );
    await this.evaluate(this.options, 'chrome.runtime.sendMessage({type:"settings_changed"})');
    const worker = (await this.command('Target.getTargets')).targetInfos.find(
      (t) =>
        t.type === 'service_worker' &&
        t.url === 'chrome-extension://' + extensionId + '/background.js',
    );
    assert.ok(worker, 'Actual worker absent');
    this.worker = (
      await this.command('Target.attachToTarget', { targetId: worker.targetId, flatten: true })
    ).sessionId;
    this.owner = await waitFor(
      () =>
        this.evaluate(
          this.options,
          '(async()=>{return (await chrome.storage.local.get("profileId")).profileId;})()',
        ),
      'Actual profile ID missing',
    );
  }
  async native(command, args) {
    return this.evaluate(
      this.worker,
      'chrome.runtime.sendNativeMessage(' +
        JSON.stringify(host) +
        ',' +
        JSON.stringify({ version: 1, id: randomUUID(), command, args }) +
        ')',
    );
  }
  async tab(url = 'about:blank') {
    return this.evaluate(
      this.options,
      'chrome.tabs.create(' + JSON.stringify({ url, active: true }) + ')',
    );
  }
  async cookie(tab, marker) {
    const stores = await this.evaluate(this.options, 'chrome.cookies.getAllCookieStores()');
    const store = stores.find((store) => store.tabIds.includes(tab.id));
    assert.ok(store?.id, 'Actual cookie-store membership missing');
    const value = await this.evaluate(
      this.options,
      'chrome.cookies.set(' +
        JSON.stringify({ url: sourceUrl, name: cookieName, value: marker, storeId: store.id }) +
        ')',
    );
    assert.equal(value.value, marker);
    return store.id;
  }
  async page(tabId) {
    const actual = (await this.evaluate(this.options, 'chrome.debugger.getTargets()')).find(
      (t) => t.tabId === tabId,
    );
    assert.ok(actual?.id, 'Actual tab debugger correlation missing');
    this.lastPage = (
      await this.command('Target.attachToTarget', { targetId: actual.id, flatten: true })
    ).sessionId;
    return this.lastPage;
  }
  async ownedPage(id) {
    const key = 'resolver-' + id;
    const record = await waitFor(
      () =>
        this.evaluate(
          this.options,
          '(async()=>{return (await chrome.storage.session.get(' +
            JSON.stringify(key) +
            '))[' +
            JSON.stringify(key) +
            '];})()',
        ),
      'Actual owned navigation record missing',
    );
    assert.equal(record.scope.profile, this.owner);
    await waitFor(
      () =>
        this.evaluate(
          this.options,
          '(async()=>{const tab=await chrome.tabs.get(' +
            record.tabId +
            ');return tab.status==="complete"&&tab.url===' +
            JSON.stringify(sourceUrl) +
            ';})()',
        ),
      'Owned HTTP tab did not complete',
    );
    return this.page(record.tabId);
  }
  async nodes(session) {
    const { root } = await this.command('DOM.getDocument', { depth: -1, pierce: true }, session);
    const out = [];
    const visit = (node) => {
      out.push(node);
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child);
    };
    visit(root);
    return out;
  }
  async click(session, predicate) {
    const node = (await this.nodes(session)).find(predicate);
    assert.ok(node, 'Actual control absent');
    await this.command('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId }, session);
    const { model } = await this.command('DOM.getBoxModel', { nodeId: node.nodeId }, session);
    const q = model.content,
      x = (q[0] + q[2] + q[4] + q[6]) / 4,
      y = (q[1] + q[3] + q[5] + q[7]) / 4;
    await this.command('Page.bringToFront', {}, session);
    for (const type of ['mousePressed', 'mouseReleased'])
      await this.command(
        'Input.dispatchMouseEvent',
        { type, x, y, button: 'left', clickCount: 1 },
        session,
      );
  }
  async clickId(session, id) {
    return this.click(session, (node) => attributes(node).id === id);
  }
  async insertToken() {
    const node = (await this.nodes(this.options)).find(
      (node) => attributes(node).id === 'navigation-transfer-code',
    );
    assert.ok(node);
    await this.command('DOM.focus', { nodeId: node.nodeId }, this.options);
    await this.command('Input.insertText', { text: token }, this.options);
  }
  async receiverTab(tab) {
    await this.click(
      this.options,
      (node) => node.nodeName === 'BUTTON' && nodeText(node).trim() === 'Reload tabs',
    );
    await waitFor(
      () =>
        this.evaluate(
          this.options,
          'document.getElementById("navigation-transfer-tab").value===' +
            JSON.stringify(String(tab.id)),
        ),
      'Actual recipient HTTP tab did not appear in options',
    );
  }
  async close() {
    if (this.socket?.readyState === WebSocket.OPEN)
      await this.command('Browser.close').catch(() => {});
    this.socket?.close();
    this.process?.kill();
  }
}
function attributes(node) {
  const out = {};
  for (let i = 0; i < (node.attributes || []).length; i += 2)
    out[node.attributes[i]] = node.attributes[i + 1];
  return out;
}
function nodeText(node) {
  return [node.nodeValue || '', ...(node.children || []).map(nodeText)].join('');
}
async function waitFor(check, message, milliseconds = 90000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await pause(150);
  }
  throw Error(message);
}
const job = () => {
  const result = cli(['list']);
  return (result.jobs || result).find((j) => j.id === jobId);
};
async function denial(browser, command, args) {
  const reply = await browser.native(command, args);
  assert.equal(reply.ok, false, 'Stale ' + command + ' unexpectedly accepted');
  return {
    command,
    denied: true,
    errorCode: reply.error?.code || null,
    reason: redact(reply.error?.message || ''),
  };
}

try {
  daemon = spawn(nativeExe, ['daemon'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  daemon.stderr.on('data', () => {});
  let settings = await waitFor(
    async () => {
      try {
        return cli(['settings']);
      } catch {
        return null;
      }
    },
    'Isolated service unavailable',
    30000,
  );
  settings = settings.settings || settings;
  settings.directory = resolve(root, 'downloads');
  settings.categories = [];
  await writeFile(resolve(root, 'settings.json'), JSON.stringify(settings));
  cli(['set', resolve(root, 'settings.json')]);
  registration =
    (/msedge/i.test(browserExe)
      ? 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\'
      : 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\') + host;
  execFileSync('reg', ['ADD', registration, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const original = new Browser('profile-source'),
    receiver = new Browser('profile-recipient');
  browsers.push(original, receiver);
  await original.launch();
  console.log(JSON.stringify({ phase: 'source-profile-loaded', browser: original.version }));
  const originalBlank = await original.tab();
  const originalStore = await original.cookie(originalBlank, markers[0]);
  // Complete a separate original-profile control; the transferred task itself stays byte-free.
  const controlDirectory = resolve(root, 'source-control');
  const control = cli([
    'add',
    sourceUrl,
    '--navigate',
    '--paused',
    '--filename',
    'transferred.bin',
    '--directory',
    controlDirectory,
  ]);
  jobId = (control.job || control).id;
  await original.evaluate(
    original.options,
    'chrome.runtime.sendMessage(' +
      JSON.stringify({ type: 'navigation_queue_continue', id: jobId }) +
      ')',
  );
  await waitFor(() => job()?.navigation_scope, 'Native source control claim absent');
  const controlPage = await original.ownedPage(jobId);
  await waitFor(
    () =>
      original.evaluate(
        controlPage,
        'Boolean(document.getElementById("__downloader_adapter_preview"))',
      ),
    'Source control preview absent',
  );
  assert.equal(await original.evaluate(controlPage, 'window.fixtureSeed'), 7);
  await original.click(
    controlPage,
    (node) => node.nodeName === 'INPUT' && attributes(node).type === 'radio',
  );
  await original.click(
    controlPage,
    (node) => node.nodeName === 'BUTTON' && nodeText(node).trim() === 'Continue',
  );
  const controlComplete = await waitFor(
    () => (job()?.state === 'complete' ? job() : null),
    'Source native control did not complete',
    120000,
  );
  const controlBytes = await readFile(resolve(controlDirectory, 'transferred.bin'));
  assert.equal(hash(controlBytes), expectedHashes[0]);
  assert.equal(controlBytes.length, bytes);
  observations.sourceControlNativeHash = hash(controlBytes);
  observations.sourceControlNativeBytes = controlComplete.bytes;
  assert.equal(await original.evaluate(controlPage, 'window.originalClicks'), 0);
  console.log(
    JSON.stringify({ phase: 'source-native-control-complete', sha256: hash(controlBytes) }),
  );
  const added = cli(['add', sourceUrl, '--navigate', '--paused', '--filename', 'transferred.bin']);
  jobId = (added.job || added).id;
  assert.ok(jobId);
  await original.evaluate(
    original.options,
    'chrome.runtime.sendMessage(' +
      JSON.stringify({ type: 'navigation_queue_continue', id: jobId }) +
      ')',
  );
  const initial = await waitFor(async () => {
    const j = job();
    return j?.navigation_scope && ['waiting_user', 'waiting_browser'].includes(j.state) ? j : null;
  }, 'Original profile did not claim task');
  assert.equal(initial.navigation_scope.profile, original.owner);
  assert.equal(initial.bytes, 0);
  assert.equal(initial.partial_created, false);
  const oldPage = await original.ownedPage(jobId);
  await waitFor(
    () =>
      original.evaluate(
        oldPage,
        'Boolean(document.getElementById("__downloader_adapter_preview"))',
      ),
    'Original production preview absent',
  );
  assert.equal(await original.evaluate(oldPage, 'window.fixtureSeed'), 7);
  await receiver.launch();
  console.log(JSON.stringify({ phase: 'recipient-profile-loaded', browser: receiver.version }));
  assert.notEqual(original.owner, receiver.owner);
  assert.equal(original.version, receiver.version);
  observations.actualProfilesDistinct = true;
  observations.browser = original.version;
  const recipientTab = await receiver.tab();
  const recipientStore = await receiver.cookie(recipientTab, markers[1]);
  observations.cookieStoreMembershipObserved = true;
  observations.sameCookieStoreName = originalStore === recipientStore;
  await receiver.evaluate(
    receiver.options,
    'chrome.tabs.update(' + recipientTab.id + ',' + JSON.stringify({ url: sourceUrl }) + ')',
  );

  const oldScope = initial.navigation_scope,
    oldSource = initial.source_generation;
  phase = 'prepare';
  console.log(JSON.stringify({ phase }));
  observations.browserPrepareDenied = await denial(original, 'navigation_transfer', {
    action: 'prepare',
    id: jobId,
    expected_scope: oldScope,
    expected_source_generation: oldSource,
    consent: true,
  });
  const prepared = desktop({
    command: 'navigation_transfer',
    args: {
      action: 'prepare',
      id: jobId,
      expected_scope: oldScope,
      expected_source_generation: oldSource,
      consent: true,
    },
  });
  token = prepared.token;
  assert.ok(typeof token === 'string' && token.length >= 32);
  observations.desktopIpcPrepare = true;
  const frozen = job();
  assert.equal(frozen.navigation_transfer_pending, true);
  assert.ok(frozen.source_generation > oldSource);
  assert.ok(frozen.navigation_scope.claim_generation > oldScope.claim_generation);
  observations.generationsBefore = { source: oldSource, claim: oldScope.claim_generation };
  observations.generationsPrepared = {
    source: frozen.source_generation,
    claim: frozen.navigation_scope.claim_generation,
  };
  const requestsBeforePreview = originRequests.filter(
    (r) => r.path === '/nav-adapters/g4u/blob',
  ).length;
  await receiver.receiverTab(recipientTab);
  await receiver.insertToken();
  await receiver.clickId(receiver.options, 'navigation-transfer-preview');
  await waitFor(
    () =>
      receiver.evaluate(
        receiver.options,
        '!document.getElementById("navigation-transfer-accept").disabled',
      ),
    'Actual receiver preview did not admit transfer',
  );
  assert.equal(
    await receiver.evaluate(
      receiver.options,
      'document.getElementById("navigation-transfer-code").value',
    ),
    '',
  );
  assert.equal(
    originRequests.filter((r) => r.path === '/nav-adapters/g4u/blob').length,
    requestsBeforePreview,
    'Preview unexpectedly navigated or fetched',
  );
  observations.actualReceiverPreview = true;
  observations.codeClearedAfterPreview = true;
  phase = 'accept';
  console.log(JSON.stringify({ phase }));
  await receiver.clickId(receiver.options, 'navigation-transfer-accept');
  const accepted = await waitFor(async () => {
    const j = job();
    return j?.navigation_scope?.profile === receiver.owner &&
      j.navigation_transfer_pending === false
      ? j
      : null;
  }, 'Actual receiver accept did not transfer authority');
  observations.actualReceiverAccept = true;
  observations.generationsAccepted = {
    source: accepted.source_generation,
    claim: accepted.navigation_scope.claim_generation,
  };
  assert.equal(accepted.source_generation, frozen.source_generation);
  assert.ok(accepted.source_generation > oldSource);
  assert.ok(accepted.navigation_scope.claim_generation > frozen.navigation_scope.claim_generation);
  assert.equal(accepted.page_url, sourceUrl);
  assert.equal(accepted.bytes, 0);
  const late = {
    id: jobId,
    owner: oldScope.profile,
    scope: oldScope,
    source_generation: oldSource,
  };
  observations.staleOperations = [];
  observations.staleOperations.push(
    await denial(original, 'browser_status', {
      ...late,
      state: 'waiting_user',
      message: 'stale fixture status',
      bytes: 0,
      total: null,
      url: sourceUrl,
    }),
  );
  observations.staleOperations.push(
    await denial(original, 'claim_navigation', { ...late, force: true }),
  );
  observations.staleOperations.push(
    await denial(original, 'browser_stream', {
      operation: 'begin',
      stream_id: randomUUID(),
      scope: oldScope,
      source_generation: oldSource,
      target: { kind: 'job', id: jobId },
      filename: 'stale.bin',
      total: bytes,
    }),
  );
  observations.staleOperations.push(
    await denial(original, 'browser_account', {
      job_id: jobId,
      owner: oldScope.profile,
      scope: oldScope,
      source_generation: oldSource,
      request: { action: 'selection' },
    }),
  );
  observations.staleOperations.push(
    await denial(original, 'captcha', { ...late, request: { action: 'snapshot' } }),
  );
  observations.staleOperations.push(
    await denial(original, 'claim_navigation', {
      id: jobId,
      owner: frozen.navigation_scope.profile,
      scope: frozen.navigation_scope,
      source_generation: frozen.source_generation,
      force: true,
    }),
  );
  assert.equal(job().navigation_scope.profile, receiver.owner);
  const page = await receiver.ownedPage(jobId);
  await waitFor(
    () =>
      receiver.evaluate(page, 'Boolean(document.getElementById("__downloader_adapter_preview"))'),
    'Transferred production preview absent',
  );
  assert.equal(await receiver.evaluate(page, 'window.fixtureSeed'), 113);
  assert.equal(await original.evaluate(oldPage, 'window.fixtureSeed'), 7);
  observations.identicalPageUrls =
    (await original.evaluate(oldPage, 'location.href')) ===
    (await receiver.evaluate(page, 'location.href'));
  assert.equal(observations.identicalPageUrls, true);
  phase = 'stream';
  console.log(JSON.stringify({ phase }));
  await receiver.click(
    page,
    (node) => node.nodeName === 'INPUT' && attributes(node).type === 'radio',
  );
  await receiver.click(
    page,
    (node) => node.nodeName === 'BUTTON' && nodeText(node).trim() === 'Continue',
  );
  const completed = await waitFor(
    async () => {
      const j = job();
      if (['failed', 'cancelled'].includes(j?.state))
        throw Error('Transferred source failed: ' + redact(j.error));
      return j?.state === 'complete' ? j : null;
    },
    'Transferred native file did not complete',
    120000,
  );
  const published = await readFile(resolve(root, 'downloads', 'transferred.bin'));
  assert.equal(hash(published), expectedHashes[1]);
  assert.notEqual(hash(published), expectedHashes[0]);
  assert.equal(published.length, bytes);
  observations.sourceSessionHash = expectedHashes[0];
  observations.recipientSessionHash = hash(published);
  observations.sessionCookieInherited = false;
  observations.originalLinkClicks = [
    await original.evaluate(oldPage, 'window.originalClicks'),
    await receiver.evaluate(page, 'window.originalClicks'),
  ];
  assert.deepEqual(observations.originalLinkClicks, [0, 0]);
  assert.equal(originRequests.filter((r) => !r.browser).length, 0, 'Desktop fetched the origin');
  assert.equal(
    originRequests.filter(
      (r) =>
        r.path === '/nav-adapters/g4u/blob' &&
        r.cookieProfile === 'source' &&
        r.phase !== 'bootstrap',
    ).length,
    0,
    'Original session replayed after prepare',
  );
  phase = 'token-reuse';
  console.log(JSON.stringify({ phase }));
  await receiver.insertToken();
  await receiver.clickId(receiver.options, 'navigation-transfer-preview');
  observations.ticketReuseDenied = Boolean(
    await waitFor(
      () =>
        receiver.evaluate(
          receiver.options,
          '(()=>{const button=document.getElementById("navigation-transfer-preview");const text=document.getElementById("navigation-transfer-code").parentElement.querySelector("p[role=status]")?.textContent;return !button.disabled&&text?.includes("transfer_ticket_unavailable")?true:false;})()',
        ),
      'Consumed ticket did not reject reuse',
    ),
  );
  await receiver.click(
    receiver.options,
    (node) => node.nodeName === 'BUTTON' && nodeText(node).trim() === 'Clear preview',
  );
  observations.tokenInExtensionStorage = false;
  for (const browser of browsers) {
    const stored = await browser.evaluate(
      browser.options,
      '(async()=>JSON.stringify({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)}))()',
    );
    if (stored.includes(token)) observations.tokenInExtensionStorage = true;
  }
  assert.equal(observations.tokenInExtensionStorage, false);
  observations.tokenInNativeDb = false;
  for (const file of ['downloader.db', 'downloader.db-wal']) {
    try {
      if ((await readFile(resolve(data, file))).includes(Buffer.from(token)))
        observations.tokenInNativeDb = true;
    } catch (error) {
      if (file === 'downloader.db' || error.code !== 'ENOENT') throw error;
    }
  }
  assert.equal(observations.tokenInNativeDb, false);
  for (const [path, record] of [
    [nativeExe, executables.hostAndDaemon],
    [cliExe, executables.cli],
    [desktopExe, executables.desktopFixture],
  ])
    assert.equal(hash(await readFile(path)), record.sha256, 'Qualification executable changed');
  const evidence = {
    acceptance: 'passed',
    mode: 'two-profile-explicit-transfer',
    recorded: new Date().toISOString(),
    sourceRevision,
    driverSha256: hash(await readFile(new URL(import.meta.url))),
    browser: original.version,
    os: process.platform,
    architecture: process.arch,
    productionBackground: true,
    productionResolver: true,
    productionReceiverOptions: true,
    diagnosticSourceChanges: false,
    nativeTransport: 'persistent connectNative; desktop prepare through restricted IPC example',
    executables,
    expectedBytes: bytes,
    actualBytes: completed.bytes,
    state: completed.state,
    sha256: hash(published),
    cookieName,
    originRequests,
    observations,
    limitations: [
      'Local fixture; no live/paid provider calls',
      'Desktop prepare uses guarded IPC fixture rather than a native desktop UI click',
      'Settings setup uses a trusted fixture action; receiver and file previews use actual production UI clicks',
      'Complete browser restart and broader private/container/partition matrix remain separate rows',
    ],
  };
  await writeFile(resolve(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  observations.failureState = [];
  for (const browser of browsers) {
    const state = { profile: browser.name };
    try {
      state.lastError = redact(
        JSON.stringify(
          await browser.evaluate(browser.options, 'chrome.storage.local.get("lastError")'),
        ),
      );
    } catch {}
    if (browser.lastPage)
      try {
        state.page = await browser.evaluate(
          browser.lastPage,
          '({path:location.pathname,readyState:document.readyState,seed:window.fixtureSeed,preview:Boolean(document.getElementById("__downloader_adapter_preview"))})',
        );
      } catch {}
    observations.failureState.push(state);
  }
  try {
    const value = job();
    observations.nativeFailureState = {
      state: value.state,
      bytes: value.bytes,
      sourceGeneration: value.source_generation,
      claimGeneration: value.navigation_scope?.claim_generation,
    };
  } catch {}
  const failure = {
    acceptance: 'pending',
    mode: 'two-profile-explicit-transfer',
    sourceRevision,
    phase,
    error: redact(error),
    observations,
  };
  await writeFile(resolve(root, 'failure.json'), JSON.stringify(failure, null, 2));
  console.log(JSON.stringify(failure, null, 2));
  throw Error(redact(error));
} finally {
  token = undefined;
  for (const browser of browsers) await browser.close();
  try {
    execFileSync(cliExe, ['quit'], { env, windowsHide: true, stdio: 'ignore', timeout: 5000 });
  } catch {}
  daemon?.kill();
  if (registration)
    execFileSync('reg', ['DELETE', registration, '/f'], { windowsHide: true, stdio: 'ignore' });
  server.close();
}
