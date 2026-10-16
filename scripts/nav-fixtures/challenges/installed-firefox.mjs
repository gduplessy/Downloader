// Installed production Firefox challenge lifecycle. Browser/native state is isolated per case.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { startChallengeServer, expectedHash } from './server.mjs';
const require = createRequire(
  new URL('../../../apps/extension/package.json', import.meta.url),
);
const { build } = require('esbuild');
const scenario = process.env.NAV_CHALLENGE_CASE ?? 'csrf';
assert(
  ['fresh', 'cancel', 'csrf', 'image', 'selected-host'].includes(scenario),
);
const driverHash = createHash('sha256')
  .update(await readFile(new URL(import.meta.url)))
  .digest('hex');
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const executable =
  process.env.NAV_BROWSER ?? 'C:/Program Files/Mozilla Firefox/firefox.exe';
const dir = resolve(
    '.fixture-challenges',
    'firefox-' + scenario + '-' + randomUUID(),
  ),
  ext = resolve(dir, 'extension'),
  data = resolve(dir, 'service');
await mkdir(ext, { recursive: true });
await mkdir(data, { recursive: true });
assert(
  process.env.NAV_NATIVE_BINARY &&
    process.env.NAV_CLI_BINARY &&
    process.env.NAV_NATIVE_REVISION,
  'Specify matching immutable native pair and exact build revision',
);
const nativeBinary = resolve(dir, 'downloader-service.exe'),
  cli = resolve(dir, 'downloader.exe');
await copyFile(process.env.NAV_NATIVE_BINARY, nativeBinary);
await copyFile(process.env.NAV_CLI_BINARY, cli);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nativeBuildRevision = process.env.NAV_NATIVE_REVISION;
const initialNativeHash = digest(await readFile(nativeBinary)),
  initialCliHash = digest(await readFile(cli));
assert.equal(
  initialNativeHash,
  '3cbd6aa2c7d65e2c4aeaabd83afed64d86e838d2c898fd8f63cb1083804056f2',
);
assert.equal(
  initialCliHash,
  '43094f64f3379c39cd24c0e3358df77d0931afa9dd81a80a9550d16e57787e0c',
);
assert.equal(nativeBuildRevision, '3b808ae1967a210fc5b3a3e461488b9f2ab6cb61');
const extId = 'downloader-challenge-' + randomUUID() + '@local',
  extensionUuid = randomUUID(),
  host = 'org.downloader.fixture_' + randomUUID().replaceAll('-', '');
const nativeManifest = resolve(dir, 'native.json');
await writeFile(
  nativeManifest,
  JSON.stringify({
    name: host,
    description: 'Isolated production challenge lifecycle',
    path: nativeBinary,
    type: 'stdio',
    allowed_extensions: [extId],
  }),
);
await writeFile(
  resolve(data, 'native-allowlist.json'),
  JSON.stringify({ chrome_ids: [], firefox_ids: [extId] }),
);
const buildResult = await build({
  metafile: true,
  entryPoints: [
    'apps/extension/src/background.ts',
    'apps/extension/src/resolver.ts',
    'apps/extension/src/options.ts',
    'apps/extension/src/content.ts',
    'apps/extension/src/discovery.ts',
  ],
  outdir: ext,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: JSON.stringify('firefox') },
  plugins: [
    {
      name: 'fixture-native-address',
      setup(builder) {
        builder.onLoad({ filter: /background\.ts$/ }, async ({ path }) => ({
          contents: (await readFile(path, 'utf8')).replaceAll(
            'org.downloader.native',
            host,
          ),
          loader: 'ts',
        }));
      },
    },
  ],
});
const sourceGraph = await Promise.all(
  Object.keys(buildResult.metafile.inputs)
    .sort()
    .map(async (path) => ({ path, sha256: digest(await readFile(path)) })),
);
await copyFile(
  'apps/extension/public/options.html',
  resolve(ext, 'options.html'),
);
await writeFile(
  resolve(ext, 'manifest.json'),
  JSON.stringify({
    manifest_version: 2,
    name: 'Downloader production challenge lifecycle',
    version: '0.1.0',
    browser_specific_settings: {
      gecko: { id: extId, strict_min_version: '115.0' },
    },
    permissions: [
      'nativeMessaging',
      'cookies',
      'tabs',
      'storage',
      'webRequest',
      'webRequestBlocking',
      'downloads',
      'contextMenus',
      'alarms',
      'http://127.0.0.1/*',
    ],
    background: { scripts: ['background.js'], persistent: false },
    options_ui: { page: 'options.html', open_in_tab: true },
  }),
);
await writeFile(
  resolve(dir, 'empty.js'),
  '// No renderer harness: production resolver only.',
);
const fixture = await startChallengeServer({ downloadLane: 'blob' });
const base = fixture.base,
  requests = fixture.requests;
const pagePath = '/nav-challenges/g4u/page';
if (process.env.NAV_PREPARE_ONLY === '1') {
  await writeFile(
    resolve(dir, 'prepared.json'),
    JSON.stringify(
      {
        sourceRevision,
        driverHash,
        sourceGraph,
        nativeBuildRevision,
        initialNativeHash,
        initialCliHash,
        browserLaunched: false,
      },
      null,
      2,
    ),
  );
  console.log(
    'Prepared production Firefox modules without browser launch: ' + dir,
  );
  await fixture.close();
  await require('esbuild').stop();
  process.exit(0);
}
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
settings.captcha = {
  enabled: false,
  external_opt_in: false,
  key_ref: '',
  task_ceiling_microusd: 0,
  total_budget_microusd: 0,
};
await writeFile(resolve(dir, 'settings.json'), JSON.stringify(settings));
execFileSync(cli, ['--json', 'set', resolve(dir, 'settings.json')], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const registry = 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\' + host;
execFileSync(
  'reg',
  ['ADD', registry, '/ve', '/t', 'REG_SZ', '/d', nativeManifest, '/f'],
  {
    windowsHide: true,
    stdio: 'ignore',
  },
);

const { createServer: createPortServer } = await import('node:net');
const portServer = createPortServer();
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
const driverPort = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const profile = resolve(dir, 'profile');
await mkdir(profile, { recursive: true });
await writeFile(
  resolve(profile, 'user.js'),
  [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.page", 0);',
    'user_pref("browser.download.folderList", 2);',
    'user_pref("browser.download.dir", ' +
      JSON.stringify(resolve(dir, 'browser-downloads')) +
      ');',
    'user_pref("browser.download.useDownloadDir", true);',
    'user_pref("remote.active-protocols", 1);',
    'user_pref("extensions.webextensions.uuids", ' +
      JSON.stringify(JSON.stringify({ [extId]: extensionUuid })) +
      ');',
  ].join('\n'),
);
let browserProc, ws, options;
let firefoxError = '';
let seq = 0;
let fixtureStage = 'startup';
const pending = new Map();
const identities = new Map();
function processes() {
  if (process.platform !== 'win32') return [];
  const script =
    'Get-CimInstance Win32_Process -Filter "Name=\'firefox.exe\'" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n="Created";e={$_.CreationDate.ToUniversalTime().ToString("o")}} | ConvertTo-Json -Compress';
  const raw = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  const result = raw.trim() ? JSON.parse(raw) : [];
  return Array.isArray(result) ? result : [result];
}
function rememberTree() {
  if (process.platform !== 'win32' || !browserProc?.pid) return;
  const all = processes(),
    parent = all.find((p) => p.ProcessId === browserProc.pid);
  if (
    !parent?.CommandLine?.includes(profile) ||
    resolve(parent.ExecutablePath).toLowerCase() !==
      resolve(executable).toLowerCase()
  )
    return;
  const owned = new Set([browserProc.pid]);
  for (let i = 0; i < all.length; i++)
    for (const p of all)
      if (owned.has(p.ParentProcessId)) owned.add(p.ProcessId);
  for (const p of all)
    if (owned.has(p.ProcessId)) identities.set(p.ProcessId, p);
}
function stopOwnedTree() {
  if (process.platform !== 'win32') {
    browserProc?.kill();
    return;
  }
  rememberTree();
  const owned = processes().filter((p) => {
    const saved = identities.get(p.ProcessId);
    return (
      saved &&
      saved.Created === p.Created &&
      saved.ParentProcessId === p.ParentProcessId &&
      saved.ExecutablePath === p.ExecutablePath
    );
  });
  const parent = owned.find(
    (p) => p.ProcessId === browserProc?.pid && p.CommandLine?.includes(profile),
  );
  // PID/profile/creation identity guards; never kill by image name.
  for (const p of parent ? [parent] : owned.reverse()) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(p.ProcessId), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {}
  }
}

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    fixtureStage = method;
    const id = ++seq;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + ' timed out'));
    }, 45000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
try {
  browserProc = spawn(
    executable,
    [
      '-headless',
      '-no-remote',
      '-profile',
      profile,
      '-remote-allow-system-access',
      '--remote-debugging-port',
      String(driverPort),
    ],
    { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  browserProc.stderr.on(
    'data',
    (data) => ((stderr += data), (firefoxError += data)),
  );
  for (let i = 0; i < 200; i++) {
    ws = new WebSocket('ws://127.0.0.1:' + driverPort + '/session');
    try {
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      break;
    } catch {
      ws.close();
      if (i === 199) throw Error(stderr);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  ws.onclose = () => {
    for (const waiter of pending.values())
      waiter.reject(Error('Firefox fixture closed'));
    pending.clear();
  };
  ws.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id === undefined) return;
    const waiter = pending.get(event.id);
    pending.delete(event.id);
    event.type === 'error'
      ? waiter?.reject(Error(JSON.stringify(event)))
      : waiter?.resolve(event.result);
  };
  rememberTree();
  const session = await send('session.new', {
    capabilities: {
      alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: false },
    },
  });
  await send('webExtension.install', {
    extensionData: { type: 'path', path: ext },
  });
  for (let attempt = 0; attempt < 200; attempt++) {
    const tree = await send('browsingContext.getTree', {});
    options = tree.contexts.find((item) =>
      item.url.startsWith('moz-extension://' + extensionUuid + '/options.html'),
    );
    if (options) break;
    if (attempt === 199)
      throw Error('Addon options page unavailable: ' + JSON.stringify(tree));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const evaluate = async (expression) => {
    const result = await send('script.evaluate', {
      expression,
      target: { context: options.context },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (result.type === 'exception')
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  await evaluate(
    `browser.storage.local.set({settings:{automatic:false,directCapture:true,extensions:[],excluded:[],bypassUntil:0,locale:'en',overlay:false}})`,
  );
  await evaluate(`browser.runtime.sendMessage({type:'settings_changed'})`);
  const nativeProbe = JSON.parse(
    await evaluate(
      '(async()=>{try{const reply=await browser.runtime.sendNativeMessage(' +
        JSON.stringify(host) +
        ",{version:1,id:crypto.randomUUID(),command:'negotiate',args:{minimum:1,maximum:1}});return JSON.stringify({transportSucceeded:true,replyKeys:Object.keys(reply??{}),version:reply?.version,ok:reply?.ok,error:reply?.error??null,dataKeys:Object.keys(reply?.data??{})})}catch(error){return JSON.stringify({transportSucceeded:false,error:String(error),name:error?.name})}})()",
    ),
  );
  await writeFile(
    resolve(dir, 'native-probe.json'),
    JSON.stringify(nativeProbe, null, 2),
  );
  console.log('Native negotiation probe', JSON.stringify(nativeProbe));
  assert.equal(
    nativeProbe.transportSucceeded,
    true,
    'Selected native host negotiation transport failed',
  );
  assert.equal(nativeProbe.ok, true, 'Selected native host negotiation failed');
  const hostDiagnostics = JSON.parse(
    await evaluate(
      `browser.runtime.sendNativeMessage(${JSON.stringify(host)},{version:1,id:crypto.randomUUID(),command:'diagnostics'}).then(reply=>{if(!reply.ok)throw Error(reply.error?.message);return JSON.stringify({version:reply.data?.version,protocol:reply.data?.protocol,platform:reply.data?.platform})})`,
    ),
  );
  const daemonDiagnostics = JSON.parse(
    execFileSync(cli, ['--json', 'diagnostics'], {
      env,
      windowsHide: true,
      encoding: 'utf8',
    }),
  );
  assert.equal(
    hostDiagnostics.version,
    daemonDiagnostics.version,
    'Selected native host and isolated daemon versions differ',
  );
  await writeFile(
    resolve(dir, 'native-readiness.json'),
    JSON.stringify(
      {
        hostDiagnostics,
        daemonDiagnostics: {
          version: daemonDiagnostics.version,
          protocol: daemonDiagnostics.protocol,
          platform: daemonDiagnostics.platform,
        },
        nativeBinarySha256: digest(await readFile(nativeBinary)),
        cliBinarySha256: digest(await readFile(cli)),
      },
      null,
      2,
    ),
  );

  const at = async (context, expression) => {
    const result = await send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (result.type === 'exception')
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const call = (...args) =>
    JSON.parse(
      execFileSync(cli, ['--json', ...args], {
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60000,
      }),
    );
  const json = async (expression) => JSON.parse(await evaluate(expression));
  const wait = async (fn, label, ms = 45000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const value = await fn();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw Error(label + ' deadline');
  };
  const added = call(
    'add',
    base + pagePath,
    '--navigate',
    '--filename',
    scenario + '.bin',
    '--sha256',
    expectedHash,
  );
  const jobId = (added.job ?? added).id;
  assert(jobId);
  await evaluate(
    'browser.runtime.sendMessage(' +
      JSON.stringify({ type: 'continue_navigation', url: base + pagePath }) +
      ')',
  );
  const owned = await wait(async () => {
    const contexts = (await send('browsingContext.getTree', {})).contexts;
    const page = contexts.find((c) => c.url === base + pagePath);
    return page &&
      (await at(
        page.context,
        'document.activeElement?.tagName==="DIV"',
      ))
      ? page
      : null;
  }, 'Actual owned production challenge');
  await send('browsingContext.activate', { context: owned.context });
  const record = await wait(async () => {
    const stored = await json(
      '(async()=>JSON.stringify({...await browser.storage.local.get(),...await browser.storage.session.get()}))()',
    );
    return stored['resolver-' + jobId];
  }, 'Native claimed resolver record');
  const inspect = async (id) => {
    const code =
      '(()=>{const rootFor=node=>node?.openOrClosedShadowRoot??(node&&browser.dom?.openOrClosedShadowRoot?.(node));const host=document.getElementById(' +
      JSON.stringify(id) +
      ')??[...document.querySelectorAll("div")].find(node=>rootFor(node)?.querySelector("section[role=dialog]")?.getAttribute("aria-label")==="Image challenge");const root=rootFor(host);if(!root)return null;const point=node=>{const rect=node.getBoundingClientRect();return {x:Math.floor(rect.x+rect.width/2),y:Math.floor(rect.y+rect.height/2)}};return {status:root.querySelector("[role=status]")?.textContent,radios:[...root.querySelectorAll("input[type=radio]")].map(n=>({checked:n.checked,disabled:n.disabled,...point(n)})),buttons:[...root.querySelectorAll("button")].map(n=>({text:n.textContent,disabled:n.disabled,...point(n)}))}})()';
    return (
      await json(
        'browser.tabs.executeScript(' +
          record.tabId +
          ',{frameId:0,code:' +
          JSON.stringify(code) +
          '}).then(JSON.stringify)',
      )
    )[0];
  };
  const pointer = async (point) =>
    send('input.performActions', {
      context: owned.context,
      actions: [
        {
          type: 'pointer',
          id: 'challenge-pointer',
          parameters: { pointerType: 'mouse' },
          actions: [
            {
              type: 'pointerMove',
              x: point.x,
              y: point.y,
              duration: 0,
              origin: 'viewport',
            },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  const control = async (label, id = 'downloader-challenge') =>
    wait(async () => {
      const ui = await inspect(id);
      return ui?.buttons.find((b) => b.text === label && !b.disabled);
    }, 'Production control ' + label);
  await pointer(await control('Use this file host: gofile.io'));
  await control('Solve locally');
  if (scenario === 'cancel') await pointer(await control('Cancel'));
  else {
    const mutations = {
      csrf: 'document.querySelector("input[name=csrf]").value="public-fixture-replaced-csrf"',
      image: 'document.querySelector("img").src+="?replacement=1"',
      'selected-host':
        'document.querySelector("input[name=selected_host]").value="ddownload.com"',
    };
    if (mutations[scenario]) await at(owned.context, mutations[scenario]);
    await pointer(await control('Solve locally'));
  }
  let actualUi = null,
    finalJob;
  if (scenario !== 'fresh') {
    if (scenario === 'cancel')
      await wait(
        async () => !(await inspect('downloader-challenge')),
        'Cancelled challenge panel dismissal',
      );
    else
      actualUi = await wait(async () => {
        const ui = await inspect('downloader-challenge');
        return ui?.status ===
          'Unsupported or expired challenge. Complete it in the page.'
          ? ui
          : null;
      }, 'Explicit stale challenge refusal');
    assert.equal(fixture.submits.length, 0, 'Invalidated challenge submitted');
    finalJob = call('list').jobs.find((j) => j.id === jobId);
    assert.equal(finalJob.bytes, 0);
    assert.equal(finalJob.state, 'waiting_user');
    assert.equal(
      requests.filter((r) => r.path.endsWith('/file.bin')).length,
      0,
    );
    await assert.rejects(readFile(finalJob.destination), { code: 'ENOENT' });
  } else {
    await wait(
      () => fixture.submits.length === 1,
      'One original CAPTCHA submission',
    );
    assert.deepEqual(fixture.submits, [
      { provider: 'g4u', host: 'gofile.io', accepted: true },
    ]);
    await wait(
      async () =>
        await at(
          owned.context,
          '!!document.getElementById("prepare-download")',
        ),
      'Fresh selected-host result document',
    );
    const prepare = JSON.parse(
      await at(
        owned.context,
        'JSON.stringify((()=>{const r=document.getElementById("prepare-download").getBoundingClientRect();return {x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2)}})())',
      ),
    );
    await pointer(prepare);
    await wait(
      async () =>
        await at(
          owned.context,
          'document.documentElement.dataset.fixtureBlobReady==="true"',
        ),
      'Original page fetch-to-owned-Blob readiness',
    );
    await evaluate(
      'browser.runtime.sendMessage(' +
        JSON.stringify({ type: 'navigation_queue_continue', id: jobId }) +
        ')',
    );
    await evaluate(
      'browser.tabs.sendMessage(' +
        record.tabId +
        ',{type:"resolver_continue"})',
    );
    const preview = await wait(async () => {
      const ui = await inspect('__downloader_adapter_preview');
      return ui?.radios.length === 1 && !ui.radios[0].disabled ? ui : null;
    }, 'Fresh selected-host Blob preview');
    await pointer(preview.radios[0]);
    await pointer(await control('Continue', '__downloader_adapter_preview'));
    finalJob = await wait(
      () => {
        const job = call('list').jobs.find((j) => j.id === jobId);
        if (['failed', 'cancelled'].includes(job?.state))
          throw Error('Transfer ' + job.state);
        return job?.state === 'complete' ? job : null;
      },
      'Supported Firefox desktop Blob stream',
      90000,
    );
    const bytes = await readFile(finalJob.destination);
    assert.equal(digest(bytes), expectedHash);
    assert.equal(bytes.length, 253952);
    assert.equal(finalJob.selected_host, 'gofile.io');
    assert.equal(finalJob.page_url, base + pagePath);
    assert.equal(
      requests.filter((r) => r.method === 'GET' && r.path.endsWith('/file.bin'))
        .length,
      1,
    );
    assert.equal(requests.filter((r) => r.method === 'HEAD').length, 0);
  }
  const tab = await json(
    'browser.tabs.get(' + record.tabId + ').then(JSON.stringify)',
  );
  const extensionProfile = await json(
    'browser.storage.local.get("profileId").then(JSON.stringify)',
  );
  assert.equal(finalJob.navigation_scope.browser, 'firefox');
  assert.equal(finalJob.navigation_scope.profile, extensionProfile.profileId);
  assert.equal(finalJob.navigation_scope.cookie_store_id, tab.cookieStoreId);
  assert.equal(finalJob.navigation_scope.private, tab.incognito);
  assert.equal(initialNativeHash, digest(await readFile(nativeBinary)));
  assert.equal(initialCliHash, digest(await readFile(cli)));
  const screenshot = await send('browsingContext.captureScreenshot', {
    context: owned.context,
  });
  await writeFile(
    resolve(dir, 'controls.png'),
    Buffer.from(screenshot.data, 'base64'),
  );
  const evidence = {
    fixture: 'production-installed-firefox-challenges-v1',
    checked_runtime_revision: sourceRevision,
    driver_sha256: driverHash,
    native_build_revision: nativeBuildRevision,
    native_binary_sha256: initialNativeHash,
    cli_binary_sha256: initialCliHash,
    browser: session.capabilities.browserVersion,
    os: process.platform,
    scenario,
    actualUi,
    state: finalJob.state,
    bytes: finalJob.bytes,
    sha256: scenario === 'fresh' ? expectedHash : null,
    requests,
    submissions: fixture.submits,
    paid_calls: 0,
    sourceGraph,
    bundleHashes: await Promise.all(
      [
        'background.js',
        'resolver.js',
        'options.js',
        'content.js',
        'discovery.js',
      ].map(async (path) => ({
        path,
        sha256: digest(await readFile(resolve(ext, path))),
      })),
    ),
    limits: [
      'Actual BiDi pointer input and read-only privileged closed-shadow inspection; screenshots need separate visual inspection',
      'CLI add plus trusted extension Continue activation; native desktop/context-menu UI not qualified',
      'Pregranted loopback permission and unique native host identity; production authorization/session ownership unchanged',
      'Supported original page fetch-to-owned-Blob stream only; Firefox binary form-navigation/download lane explicitly pending',
      'Live hosts/accounts, paid solving, private addon, ESR and other platforms pending',
    ],
  };
  await mkdir('.local/nav-challenges', { recursive: true });
  await writeFile(
    resolve(dir, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
  await writeFile(
    '.local/nav-challenges/installed-firefox-' + scenario + '.json',
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence, null, 2));
  await send('session.end', {});
} catch (error) {
  await writeFile(
    resolve(dir, 'failure.json'),
    JSON.stringify(
      { stage: fixtureStage, error: String(error), requests },
      null,
      2,
    ),
  );
  throw error;
} finally {
  for (const waiter of pending.values())
    waiter.reject(Error('Firefox fixture finished'));
  pending.clear();
  ws?.close();
  await writeFile(resolve(dir, 'owned-firefox-stderr.log'), firefoxError);
  await writeFile(resolve(dir, 'owned-daemon-stderr.log'), daemonError);
  stopOwnedTree();
  browserProc?.kill();
  browserProc?.stderr.destroy();
  browserProc?.unref();
  daemon.kill();
  daemon.stderr.destroy();
  daemon.unref();
  await fixture.close();
  await require('esbuild').stop();
  execFileSync('reg', ['DELETE', registry, '/f'], {
    windowsHide: true,
    stdio: 'ignore',
  });
}
