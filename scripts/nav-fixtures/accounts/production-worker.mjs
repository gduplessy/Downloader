import { startAccountFixtureServer, payload, expectedHash } from './server.mjs';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
const existingSession = process.env.NAV_EXISTING_SESSION === '1';
const productVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceHashes = Object.fromEntries(
  await Promise.all(
    [
      'apps/extension/src/background.ts',
      'apps/extension/src/resolver.ts',
      'scripts/nav-fixtures/accounts/server.mjs',
    ].map(async (path) => [
      path,
      createHash('sha256').update(await readFile(path)).digest('hex'),
    ]),
  ),
);
const executable =
  process.env.NAV_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = resolve('.fixture-streams', 'production-accounts-' + Date.now());
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
const nativeBinary = resolve('.local/cargo-accounts/debug/downloader-service.exe');
const cli = resolve('.local/cargo-accounts/debug/downloader.exe');
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
          contents: (await readFile(path, 'utf8')).replaceAll('org.downloader.native', host),
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
const fixture = await startAccountFixtureServer({
  port: 0,
  harness: resolve(dir, 'no-mocked-harness.js'),
});
const base = fixture.base;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requests = fixture.counts;
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
const desktopBinary = resolve('.local/cargo-accounts/debug/examples/account_fixture_command.exe');
const desktop = (command) =>
  JSON.parse(
    execFileSync(desktopBinary, [], {
      env,
      windowsHide: true,
      encoding: 'utf8',
      input: JSON.stringify(command),
    }),
  );
const savedAccountId = crypto.randomUUID();
let accountSaved = false;
let browserProc, ws, observedBrowserVersion;
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
  observedBrowserVersion = version.product;
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
        base + '/nav-adapters/ddownload/login',
        '--navigate',
        '--paused',
        '--filename',
        'account-fixture.bin',
      ],
      { env, windowsHide: true, encoding: 'utf8' },
    ),
  );
  const jobId = (added.job ?? added).id;
  assert.ok(jobId, JSON.stringify(added));
  await evaluate(
    `chrome.runtime.sendMessage({type:'navigation_queue_continue',id:${JSON.stringify(jobId)}})`,
  );
  const jobs = () => {
    const listed = JSON.parse(
      execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8' }),
    );
    return listed.jobs ?? listed;
  };
  let job;
  for (let i = 0; i < 150; i++) {
    job = jobs().find((item) => item.id === jobId);
    if (job?.navigation_scope) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(job?.navigation_scope, 'Production worker did not claim fixture navigation');
  const ownedTabs = await evaluate(
    `chrome.tabs.query({}).then(tabs=>tabs.filter(tab=>tab.url?.startsWith(${JSON.stringify(base + '/nav-adapters/ddownload/')})).length)`,
  );
  assert.equal(ownedTabs, 1, 'One job must create exactly one owned browser tab');
  for (let i = 0; i < 150; i++) {
    const ready = await evaluate(
      `chrome.tabs.query({}).then(tabs=>tabs.some(tab=>tab.url?.startsWith(${JSON.stringify(base + '/nav-adapters/ddownload/')} )&&tab.status==='complete'))`,
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  if (existingSession) {
    const targets = await command('Target.getTargets');
    const current = targets.targetInfos.find(
      (t) => t.type === 'page' && t.url.startsWith(base + '/nav-adapters/ddownload/'),
    );
    assert.ok(current, 'Owned fixture login tab unavailable');
    const manual = (
      await command('Target.attachToTarget', { targetId: current.targetId, flatten: true })
    ).sessionId;
    await command(
      'Runtime.evaluate',
      {
        expression: `(()=>{const form=document.querySelector('form[data-nav-login]');form.elements.username.value='alice';form.elements.password.value='fixture-only';form.requestSubmit()})()`,
        returnByValue: true,
        userGesture: true,
      },
      manual,
    );
    await command('Target.detachFromTarget', { sessionId: manual });
    for (let i = 0; i < 150; i++) {
      if (
        fixture.counts.login === 1 &&
        (await command('Target.getTargets')).targetInfos.some(
          (t) => t.url === base + '/nav-adapters/ddownload/account',
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(
      fixture.counts.login,
      1,
      'Manual fixture sign-in did not create the existing session',
    );
    for (let i = 0; i < 150; i++) {
      const ready = await evaluate(
        `chrome.tabs.query({}).then(tabs=>tabs.some(tab=>tab.url===${JSON.stringify(base + '/nav-adapters/ddownload/account')}&&tab.status==='complete'))`,
      );
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  desktop({
    command: 'site_account',
    args: {
      action: 'save',
      account: {
        revision: 0,
        id: savedAccountId,
        label: 'Permitted account fixture',
        origin: base,
        provider: 'local-fixture',
        account_id: 'alice',
        scope: job.navigation_scope,
        saved_fill: !existingSession,
        credential_ref: null,
      },
      password: existingSession ? null : 'fixture-only',
    },
  });
  accountSaved = true;
  desktop({
    command: 'site_account',
    args: { action: 'select', job_id: jobId, account_id: savedAccountId, mode: 'premium' },
  });
  await evaluate(
    `chrome.runtime.sendMessage({type:'navigation_queue_continue',id:${JSON.stringify(jobId)}})`,
  );
  let fillClicked = existingSession;
  let accountSession;
  for (let i = 0; !existingSession && i < 150; i++) {
    const targets = await command('Target.getTargets');
    const current = targets.targetInfos.find(
      (t) => t.type === 'page' && t.url.startsWith(base + '/nav-adapters/ddownload/'),
    );
    if (current) {
      if (!accountSession)
        accountSession = (
          await command('Target.attachToTarget', { targetId: current.targetId, flatten: true })
        ).sessionId;
      const result = await command(
        'Runtime.evaluate',
        {
          expression: `(()=>{const button=document.querySelector('[data-downloader-ui="account"] button');if(button?.textContent==='Fill and submit this sign-in form'&&!button.disabled){button.click();return true};return false})()`,
          returnByValue: true,
          userGesture: true,
        },
        accountSession,
      );
      if (result.result?.value) {
        // Hand the fixture page back to production chrome.debugger before navigation/capture.
        await command('Target.detachFromTarget', { sessionId: accountSession });
        accountSession = undefined;
        fillClicked = true;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(
    fillClicked,
    JSON.stringify({
      reason: 'Explicit production saved-fill control unavailable',
      job: jobs().find((item) => item.id === jobId),
      consoleEvents,
    }),
  );
  const deadline = Date.now() + 90000;
  for (let attempt = 0; attempt < 600 && Date.now() < deadline; attempt++) {
    job = jobs().find((item) => item.id === jobId);
    if (job?.state === 'complete') break;
    if (['failed', 'cancelled'].includes(job?.state))
      throw Error(JSON.stringify({ job, requests, consoleEvents }));
    await new Promise((r) => setTimeout(r, 200));
  }
  let accountFailure;
  if (job?.state !== 'complete' && job?.bytes === 0) {
    const target = (await command('Target.getTargets')).targetInfos.find(
      (t) => t.type === 'page' && t.url.startsWith(base + '/nav-adapters/ddownload/'),
    );
    if (target) {
      const probe = (
        await command('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      ).sessionId;
      const result = await command(
        'Runtime.evaluate',
        {
          expression: `document.querySelector('[data-downloader-ui="account"]')?.dataset.downloaderAccountFailure ?? null`,
          returnByValue: true,
        },
        probe,
      );
      accountFailure = result.result?.value;
      await command('Target.detachFromTarget', { sessionId: probe });
    }
  }
  assert.equal(
    job?.state,
    'complete',
    JSON.stringify({
      job,
      requests,
      consoleEvents,
      accountFailure,
      diagnostics: await evaluate(`chrome.runtime.sendMessage({type:'diagnostics'})`),
    }),
  );
  const run = {
    result: { value: { jobs: [job], productionBackground: true, productionResolver: true } },
  };
  assert.equal(requests.login, 1, 'Login must submit once');
  assert.equal(requests.file, 1, 'Premium file must be transferred once');
  assert.equal(requests.purchase, 0, 'No purchase or advertisement requests permitted');
  assert.equal(
    job.selected_host,
    'ddownload.com',
    'Selected downstream provider must survive authenticated redirect and native capture',
  );
  assert.equal(
    job.page_url,
    base + '/nav-adapters/ddownload/login',
    'Original provenance must be preserved',
  );
  for (const file of ['account-fixture.bin']) {
    const bytes = await readFile(resolve(dir, 'downloads', file));
    assert.equal(bytes.length, payload.length);
    assert.equal(digest(bytes), digest(payload));
  }
  assert.ok(run.result.value.jobs.every((job) => job.state === 'complete'));
  const evidence = {
    browser: version.product,
    productVersion,
    sourceCommit,
    sourceHashes,
    os: process.platform,
    architecture: process.arch,
    extensionAPI: 'Production saved-fill/native keyring grant and entitled-session direct stream',
    transport: 'persistent chrome.runtime.connectNative',
    submissions: requests.login,
    accountPath: existingSession
      ? 'Selected existing browser session, no stored credential'
      : 'Explicit opt-in saved credential fill',
    debuggerHandoff:
      'Driver page session detached immediately after explicit fill dispatch; production chrome.debugger owns capture',
    fixtureRequests: requests,
    sha256: digest(payload),
    expectedSha256: expectedHash,
    ...run.result.value,
    limitations: [
      'Local fixtures; live hosts/accounts pending',
      'No stable/ESR Firefox or other OS qualification from this run',
      'Fixture manifest grants loopback optional permissions; runtime permission prompt is not qualified',
      'One authenticated premium fixture accepted; live account/provider API and other browser/OS rows pending',
    ],
  };
  await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await writeFile(
    resolve(dir, 'failure.json'),
    JSON.stringify(
      {
        browser: observedBrowserVersion,
        version: productVersion,
        sourceCommit,
        fixture: 'nav-account-production-v1',
        accountPath: existingSession ? 'existing-session' : 'saved-fill',
        error: String(error),
        fixtureRequests: requests,
        qualification: 'Failed; no acceptance claimed',
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  let cleanupError;
  if (accountSaved) {
    try {
      desktop({ command: 'site_account', args: { action: 'remove', id: savedAccountId } });
      const accounts = desktop({ command: 'site_account', args: { action: 'list' } });
      assert.ok(!JSON.stringify(accounts).includes(savedAccountId), 'Test account cleanup failed');
    } catch (error) {
      cleanupError = error;
    }
  }
  if (ws) {
    await Promise.race([
      command('Browser.close').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    ws.close();
  }
  browserProc?.kill();
  browserProc?.stderr.destroy();
  browserProc?.unref();
  daemon.kill();
  daemon.stderr.destroy();
  daemon.unref();
  await fixture.close();
  // Remove only the unique fixture-created registration; user host registrations are never modified.
  execFileSync('reg', ['DELETE', registry, '/f'], { windowsHide: true, stdio: 'ignore' });
  if (cleanupError) throw cleanupError;
}
