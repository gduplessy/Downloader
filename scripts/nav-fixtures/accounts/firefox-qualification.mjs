import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { startAccountFixtureServer } from './server.mjs';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (check, label, ms = 90000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(150);
  }
  throw Error(label + ' timed out');
};
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const productVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const dir = resolve('.fixture-streams', 'firefox-accounts-' + Date.now());
const ext = resolve(dir, 'extension'),
  data = resolve(dir, 'service'),
  profile = resolve(dir, 'profile');
for (const path of [ext, data, profile, resolve(dir, 'native')])
  await mkdir(path, { recursive: true });
const pair =
  process.env.NAV_NATIVE_PAIR ??
  'C:/Users/gduplessy/code/Downloader/.fixture-streams/native-pairs/3b808ae-0.25.1';
const nativeRevision = '3b808ae1967a210fc5b3a3e461488b9f2ab6cb61';
const binaries = {
  'downloader-service.exe': '3cbd6aa2c7d65e2c4aeaabd83afed64d86e838d2c898fd8f63cb1083804056f2',
  'downloader.exe': '43094f64f3379c39cd24c0e3358df77d0931afa9dd81a80a9550d16e57787e0c',
};
for (const [name, hash] of Object.entries(binaries)) {
  assert.equal(
    digest(await readFile(resolve(pair, name))),
    hash,
    'Immutable native input mismatch',
  );
  await copyFile(resolve(pair, name), resolve(dir, 'native', name));
  assert.equal(digest(await readFile(resolve(dir, 'native', name))), hash, 'Native copy mismatch');
}
const nativeBinary = resolve(dir, 'native/downloader-service.exe'),
  cli = resolve(dir, 'native/downloader.exe');
const desktopBinary = resolve(
  process.env.NAV_DESKTOP_HELPER ??
    '.local/firefox-accounts-helper/debug/examples/account_fixture_command.exe',
);
const host = 'org.downloader.fixture_' + randomUUID().replaceAll('-', '');
const extId = 'downloader-accounts-' + randomUUID() + '@local',
  extensionUuid = randomUUID();
const executable = process.env.NAV_BROWSER ?? 'C:/Program Files/Mozilla Firefox/firefox.exe';
const env = { ...process.env, DOWNLOADER_DATA_DIR: data };
const call = (args) =>
  JSON.parse(execFileSync(cli, ['--json', ...args], { env, windowsHide: true, encoding: 'utf8' }));
const desktop = (command) =>
  JSON.parse(
    execFileSync(desktopBinary, [], {
      env,
      windowsHide: true,
      encoding: 'utf8',
      input: JSON.stringify(command),
    }),
  );
const list = () => {
  const result = call(['list']);
  return result.jobs ?? result;
};
const payloads = Object.fromEntries(
  ['alice', 'bob'].map((name, index) => [
    name,
    Buffer.from(('Firefox account ' + name + ' permitted payload\n').repeat(8192 + index)),
  ]),
);
const fixture = await startAccountFixtureServer({
  port: 0,
  harness: resolve(dir, 'absent-mocked-harness.js'),
  accountPayloads: payloads,
  pageOwnedBlob: true,
});
const base = fixture.base;
const report = {
  sourceRevision,
  productVersion,
  nativeRevision,
  nativeHashes: binaries,
  fixtureSha256: digest(await readFile(import.meta.filename)),
  helperSha256: digest(await readFile(desktopBinary)),
  helperSourceRevision: 'd99c2f889c8d7819196b5790ed4f66f93e5a84e6',
  initialActivation:
    'Synthetic invocation of unchanged registered production context-menu listener using actual browser.tabs.get metadata',
  nativeContextMenuUiQualified: false,
  supportedDownloadLane:
    'Authenticated original page fetch to owned Blob, streamed directly to desktop',
  productionSourceChanges: ['Unique native host address substitution only'],
  rows: [],
  negative: [],
  pending: [
    'Live hosts/accounts',
    'Firefox ESR',
    'Other operating systems',
    'Native context-menu UI',
    'Positive private addon permission acceptance',
  ],
  fixtureWake:
    'Options page sends fixture_ping every 500ms; ordinary background suspension not qualified',
};
const nativeManifest = resolve(dir, 'native.json');
await writeFile(
  nativeManifest,
  JSON.stringify({
    name: host,
    description: 'Isolated Firefox account fixture',
    path: nativeBinary,
    type: 'stdio',
    allowed_extensions: [extId],
  }),
);
await writeFile(
  resolve(data, 'native-allowlist.json'),
  JSON.stringify({ chrome_ids: [], firefox_ids: [extId] }),
);
await writeFile(
  resolve(ext, 'menu-bootstrap.js'),
  'globalThis.__fixtureRegisteredMenuHandlers=[];const event=browser.contextMenus.onClicked;const add=event.addListener.bind(event);event.addListener=function(handler){globalThis.__fixtureRegisteredMenuHandlers.push(handler);return add(handler)};',
);
await writeFile(
  resolve(ext, 'scope-helper.js'),
  `globalThis.__accountFixture={async activate(id,url){const tab=await browser.tabs.get(id);const handlers=globalThis.__fixtureRegisteredMenuHandlers;if(!handlers.length)throw Error('Production menu listener absent');for(const handler of handlers)handler({menuItemId:'navigate',linkUrl:url,pageUrl:tab.url},tab);return {cookieStoreId:tab.cookieStoreId,incognito:tab.incognito}}};`,
);
const compiled = await build({
  absWorkingDir: process.cwd(),
  metafile: true,
  entryPoints: ['apps/extension/src/background.ts', 'apps/extension/src/resolver.ts'],
  outdir: ext,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: JSON.stringify('firefox') },
  plugins: [
    {
      name: 'unique-native-host',
      setup(builder) {
        builder.onLoad(
          { filter: /(?:background|transport|resolver|capture)\.ts$/ },
          async ({ path }) => ({
            contents: (await readFile(path, 'utf8')).replaceAll('org.downloader.native', host),
            loader: 'ts',
          }),
        );
      },
    },
  ],
});
report.sourceHashes = Object.fromEntries(
  await Promise.all(
    Object.keys(compiled.metafile.inputs).map(async (path) => [path, digest(await readFile(path))]),
  ),
);
report.bundleHashes = Object.fromEntries(
  await Promise.all(
    ['background.js', 'resolver.js', 'scope-helper.js', 'menu-bootstrap.js'].map(async (name) => [
      name,
      digest(await readFile(resolve(ext, name))),
    ]),
  ),
);
await writeFile(resolve(ext, 'options.html'), '<script src="wake.js"></script>');
await writeFile(
  resolve(ext, 'wake.js'),
  'setInterval(()=>browser.runtime.sendMessage({type:"fixture_ping"}).catch(()=>{}),500)',
);
await writeFile(
  resolve(ext, 'manifest.json'),
  JSON.stringify({
    manifest_version: 2,
    name: 'Downloader Firefox account qualification',
    version: '0.1.0',
    browser_specific_settings: { gecko: { id: extId, strict_min_version: '115.0' } },
    permissions: [
      'nativeMessaging',
      'cookies',
      'tabs',
      'storage',
      'webRequest',
      'webRequestBlocking',
      'downloads',
      'contextMenus',
      'contextualIdentities',
      'alarms',
      'http://127.0.0.1/*',
    ],
    background: {
      scripts: ['menu-bootstrap.js', 'background.js', 'scope-helper.js'],
      persistent: false,
    },
    options_ui: { page: 'options.html', open_in_tab: true },
  }),
);
const portServer = createServer();
await new Promise((r) => portServer.listen(0, '127.0.0.1', r));
const port = portServer.address().port;
await new Promise((r) => portServer.close(r));
await writeFile(
  resolve(profile, 'user.js'),
  [
    'user_pref("browser.shell.checkDefaultBrowser",false);',
    'user_pref("privacy.userContext.enabled",true);',
    'user_pref("extensions.allowPrivateBrowsingByDefault",true);',
    'user_pref("remote.active-protocols",1);',
    'user_pref("extensions.webextensions.uuids",' +
      JSON.stringify(JSON.stringify({ [extId]: extensionUuid })) +
      ');',
  ].join('\n'),
);
const registry = 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\' + host;
let daemon,
  browserProc,
  ws,
  seq = 0,
  stage = 'startup';
const pending = new Map(),
  accountIds = [];
function processes() {
  const script =
    'Get-CimInstance Win32_Process | Where-Object {$_.Name -in @("firefox.exe","downloader-service.exe")} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n="Created";e={$_.CreationDate.ToUniversalTime().ToString("o")}} | ConvertTo-Json -Compress';
  const raw = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, encoding: 'utf8' },
  ).trim();
  const all = raw ? JSON.parse(raw) : [];
  return Array.isArray(all) ? all : [all];
}
function stopOwned() {
  const all = processes();
  const roots = all.filter(
    (p) =>
      p.ExecutablePath === nativeBinary ||
      (p.ProcessId === browserProc?.pid && p.CommandLine?.includes(profile)),
  );
  for (const saved of roots) {
    const current = processes().find((p) => p.ProcessId === saved.ProcessId);
    if (current?.Created === saved.Created && current.ExecutablePath === saved.ExecutablePath)
      try {
        execFileSync('taskkill.exe', ['/PID', String(saved.ProcessId), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {}
  }
}
const send = (method, params = {}) =>
  new Promise((resolveResult, reject) => {
    stage = method;
    const id = ++seq;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + ' timed out'));
    }, 45000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timeout);
        resolveResult(v);
      },
      reject: (e) => {
        clearTimeout(timeout);
        reject(e);
      },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
try {
  daemon = spawn(nativeBinary, ['daemon'], { env, windowsHide: true, stdio: 'ignore' });
  let settings = await wait(
    () => {
      try {
        return call(['settings']);
      } catch {
        return null;
      }
    },
    'Native readiness',
    30000,
  );
  settings = settings.settings ?? settings;
  settings.directory = resolve(dir, 'downloads');
  settings.categories = [];
  await writeFile(resolve(dir, 'settings.json'), JSON.stringify(settings));
  call(['set', resolve(dir, 'settings.json')]);
  execFileSync('reg', ['ADD', registry, '/ve', '/t', 'REG_SZ', '/d', nativeManifest, '/f'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  browserProc = spawn(
    executable,
    [
      '-headless',
      '-no-remote',
      '-profile',
      profile,
      '-remote-allow-system-access',
      '--remote-debugging-port',
      String(port),
    ],
    { env, windowsHide: true, stdio: 'ignore' },
  );
  await wait(
    async () => {
      const candidate = new WebSocket('ws://127.0.0.1:' + port + '/session');
      try {
        await new Promise((r, j) => {
          candidate.onopen = r;
          candidate.onerror = j;
        });
        ws = candidate;
        return true;
      } catch {
        candidate.close();
        return null;
      }
    },
    'Firefox startup',
    60000,
  );
  ws.onclose = () => {
    for (const waiter of pending.values()) waiter.reject(Error('Owned Firefox closed'));
    pending.clear();
  };
  ws.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    const waiter = pending.get(event.id);
    if (!waiter) return;
    pending.delete(event.id);
    event.type === 'error'
      ? waiter.reject(Error(JSON.stringify(event)))
      : waiter.resolve(event.result);
  };
  const session = await send('session.new', {
    capabilities: { alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: false } },
  });
  report.browser = session.capabilities;
  await send('webExtension.install', { extensionData: { type: 'path', path: ext } });
  const options = await wait(async () => {
    const tree = await send('browsingContext.getTree');
    return tree.contexts.find((c) =>
      c.url.startsWith('moz-extension://' + extensionUuid + '/options.html'),
    );
  }, 'Addon options');
  const at = async (context, expression) => {
    const value = await send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (value.type === 'exception') throw Error(JSON.stringify(value.exceptionDetails));
    return value.result?.value;
  };
  const evaluate = (expression) => at(options.context, expression);
  const json = async (expression) => JSON.parse(await evaluate(expression));
  await evaluate(
    `browser.storage.local.set({settings:{automatic:false,directCapture:true,extensions:[],excluded:[],bypassUntil:0,locale:'en',overlay:false}})`,
  );
  await evaluate(`browser.runtime.sendMessage({type:'settings_changed'})`);
  report.nativeDiagnostics = await json(
    `browser.runtime.sendNativeMessage(${JSON.stringify(host)},{version:1,id:crypto.randomUUID(),command:'diagnostics'}).then(reply=>JSON.stringify({ok:reply.ok,version:reply.data?.version,platform:reply.data?.platform}))`,
  );
  assert.equal(report.nativeDiagnostics.ok, true);
  assert.equal(report.nativeDiagnostics.version, '0.25.1');
  const contexts = [];
  for (const name of ['alice', 'bob']) {
    const user = await send('browser.createUserContext');
    const created = await send('browsingContext.create', {
      type: 'tab',
      userContext: user.userContext,
    });
    await send('browsingContext.navigate', {
      context: created.context,
      url: base + '/nav-adapters/ddownload/login?source=' + name,
      wait: 'complete',
    });
    const tab = await wait(async () => {
      const tabs = await json('browser.tabs.query({}).then(JSON.stringify)');
      return tabs.find((t) => t.url === base + '/nav-adapters/ddownload/login?source=' + name);
    }, 'Actual container tab');
    assert.equal(tab.incognito, false);
    assert.ok(tab.cookieStoreId.startsWith('firefox-container-'));
    contexts.push({
      name,
      context: created.context,
      tabId: tab.id,
      userContext: user.userContext,
      cookieStoreId: tab.cookieStoreId,
    });
  }
  assert.notEqual(contexts[0].cookieStoreId, contexts[1].cookieStoreId);
  report.contexts = contexts;
  // Existing session is created through the actual visible form; no cookie injection/export.
  const bob = contexts[1];
  await at(
    bob.context,
    `(()=>{const form=document.querySelector('form[data-nav-login]');form.elements.username.value='bob';form.elements.password.value='fixture-only';form.requestSubmit();return true})()`,
  );
  await wait(async () => {
    const tree = await send('browsingContext.getTree');
    return tree.contexts.find(
      (c) => c.context === bob.context && c.url === base + '/nav-adapters/ddownload/account',
    );
  }, 'Existing Bob session');
  for (const context of contexts) {
    stage = 'activate-' + context.name;
    const before = new Set(list().map((j) => j.id));
    const url =
      base + '/nav-adapters/ddownload/' + (context.name === 'alice' ? 'login' : 'account');
    const activation = await json(
      `browser.extension.getBackgroundPage().__accountFixture.activate(${context.tabId},${JSON.stringify(url)}).then(JSON.stringify)`,
    );
    assert.equal(activation.cookieStoreId, context.cookieStoreId);
    let job = await wait(
      () => list().find((j) => !before.has(j.id) && j.page_url === url && j.navigation_scope),
      'Scoped account job',
    );
    assert.equal(job.navigation_scope.cookie_store_id, context.cookieStoreId);
    const accountId = randomUUID();
    accountIds.push(accountId);
    desktop({
      command: 'site_account',
      args: {
        action: 'save',
        account: {
          revision: 0,
          id: accountId,
          label: 'Firefox ' + context.name + ' fixture',
          origin: base,
          provider: 'local-fixture',
          account_id: context.name,
          scope: job.navigation_scope,
          saved_fill: context.name === 'alice',
          credential_ref: null,
        },
        password: context.name === 'alice' ? 'fixture-only' : null,
      },
    });
    if (context.name === 'bob') {
      let refused = false;
      try {
        desktop({
          command: 'site_account',
          args: { action: 'select', job_id: job.id, account_id: accountIds[0], mode: 'premium' },
        });
      } catch {
        refused = true;
      }
      assert.equal(refused, true, 'Alice container account must not bind to Bob');
      report.negative.push({ case: 'cross-container-account-selection', refused });
    }
    desktop({
      command: 'site_account',
      args: { action: 'select', job_id: job.id, account_id: accountId, mode: 'premium' },
    });
    await evaluate(
      `browser.runtime.sendMessage({type:'navigation_queue_continue',id:${JSON.stringify(job.id)}})`,
    );
    const record = await wait(async () => {
      const stored = await json(
        `(async()=>{const a=await browser.storage.local.get();const b=browser.storage.session?await browser.storage.session.get():{};return JSON.stringify({...a,...b}[${JSON.stringify('resolver-' + job.id)}]??null)})()`,
      );
      if (!stored) return null;
      const tab = await json(`browser.tabs.get(${stored.tabId}).then(JSON.stringify)`);
      assert.equal(tab.cookieStoreId, context.cookieStoreId);
      return stored;
    }, 'Actual scoped resolver');
    if (context.name === 'alice') {
      await wait(async () => {
        const result = await json(
          `browser.tabs.executeScript(${record.tabId},{frameId:0,code:${JSON.stringify(`(()=>{const b=document.querySelector('[data-downloader-ui="account"] button');if(b?.textContent==='Fill and submit this sign-in form'&&!b.disabled){b.click();return true}return false})()`)}}).then(JSON.stringify)`,
        );
        return result[0];
      }, 'Production saved-fill control');
    }
    await wait(async () => {
      const result = await json(
        `browser.tabs.executeScript(${record.tabId},{frameId:0,code:${JSON.stringify(`(()=>{const button=document.getElementById('prepare-download');if(!button)return false;button.click();return true})()`)}}).then(JSON.stringify)`,
      );
      return result[0];
    }, 'Original page permitted download preparation');
    job = await wait(() => {
      const current = list().find((j) => j.id === job.id);
      if (['failed', 'cancelled'].includes(current?.state))
        throw Error('Account transfer ' + current.state);
      return current?.state === 'complete' ? current : null;
    }, 'Authenticated transfer');
    const file = await readFile(job.destination);
    assert.equal(digest(file), digest(payloads[context.name]));
    assert.equal(file.length, payloads[context.name].length);
    assert.equal(job.selected_host, 'ddownload.com');
    report.rows.push({
      account: context.name,
      mode: context.name === 'alice' ? 'saved-fill OS keyring' : 'existing entitled session',
      scope: job.navigation_scope,
      sourceGeneration: job.source_generation,
      selectedHost: job.selected_host,
      bytes: file.length,
      sha256: digest(file),
      state: job.state,
    });
  }
  assert.equal(fixture.counts.login, 2);
  assert.equal(fixture.counts.file, 2);
  assert.equal(fixture.counts.purchase, 0);
  report.requests = fixture.requests;
  assert.deepEqual(
    fixture.requests.filter((r) => r.path.endsWith('/premium.bin')).map((r) => r.account),
    ['alice', 'bob'],
  );
  const privateResult = await json(
    `(async()=>{try{const w=await browser.windows.create({incognito:true,url:'about:blank'});await browser.windows.remove(w.id);return JSON.stringify({permitted:true})}catch(error){return JSON.stringify({permitted:false,error:String(error)})}})()`,
  );
  report.privatePermission = privateResult;
  report.outcome = 'passed';
  await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      { outcome: report.outcome, evidence: resolve(dir, 'evidence.json'), rows: report.rows },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    resolve(dir, 'failure.json'),
    JSON.stringify({ ...report, stage, error: String(error), requests: fixture.requests }, null, 2),
  );
  throw error;
} finally {
  for (const id of accountIds)
    try {
      desktop({ command: 'site_account', args: { action: 'remove', id } });
    } catch {}
  try {
    const result = desktop({ command: 'site_account', args: { action: 'list' } });
    await writeFile(
      resolve(dir, 'cleanup.json'),
      JSON.stringify(
        {
          removed: accountIds.length,
          remainingFixtureAccounts: accountIds.filter((id) => JSON.stringify(result).includes(id))
            .length,
        },
        null,
        2,
      ),
    );
  } catch {}
  try {
    await Promise.race([send('browser.close'), sleep(3000)]);
  } catch {}
  ws?.close();
  stopOwned();
  await fixture.close();
  try {
    execFileSync('reg', ['DELETE', registry, '/f'], { windowsHide: true, stdio: 'ignore' });
  } catch {}
}
