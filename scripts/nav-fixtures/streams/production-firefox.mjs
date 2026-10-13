import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
const runnerCwd = process.cwd();
if (process.env.NAV_SOURCE_ROOT) process.chdir(await realpath(process.env.NAV_SOURCE_ROOT));
const sourceRevision =
  process.env.NAV_SOURCE_REVISION ??
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(sourceRevision, /^[a-f0-9]{40}$/, 'Record exact checked extension source revision');
const scenario = process.env.NAV_SCENARIO ?? 'post';
assert.ok(['post', 'blob', 'xhr'].includes(scenario), 'Select post, blob or xhr');
const filename =
  process.env.NAV_FILENAME ??
  (scenario === 'blob'
    ? 'original-blob.bin'
    : scenario === 'xhr'
      ? 'original-xhr.bin'
      : 'original-post.bin');
const pagePath = '/nav-adapters/g4u/' + scenario;
const executable = process.env.NAV_BROWSER || 'C:/Program Files/Mozilla Firefox/firefox.exe';
const dir = resolve('.fixture-streams', 'firefox-production-' + Date.now());
const ext = resolve(dir, 'extension');
const data = resolve(dir, 'service');
await mkdir(ext, { recursive: true });
await mkdir(data, { recursive: true });
const extId = 'downloader-nav-fixture-' + crypto.randomUUID() + '@local';
const extensionUuid = crypto.randomUUID();
const host = 'org.downloader.fixture_' + crypto.randomUUID().replaceAll('-', '');
assert.ok(
  process.env.NAV_NATIVE_BINARY,
  'NAV_NATIVE_BINARY must name the checked service executable',
);
assert.ok(process.env.NAV_CLI_BINARY, 'NAV_CLI_BINARY must name the checked CLI executable');
const nativeBinary = await realpath(resolve(runnerCwd, process.env.NAV_NATIVE_BINARY));
const cli = await realpath(resolve(runnerCwd, process.env.NAV_CLI_BINARY));
const nativeBuildRevision = process.env.NAV_NATIVE_REVISION ?? null;
if (nativeBuildRevision)
  assert.match(nativeBuildRevision, /^[a-f0-9]{40}$/, 'Record exact native build source revision');
const nativeManifest = resolve(dir, 'native.json');
let nativeHostPath = nativeBinary;
if (process.env.NAV_NATIVE_STDERR === '1') {
  assert.equal(process.platform, 'win32', 'Diagnostic stderr wrapper is Windows only');
  const wrapperSource = resolve(dir, 'native-stderr.cs'),
    wrapperExe = resolve(dir, 'native-stderr.exe');
  const wrapperLog = resolve(dir, 'owned-native-host-stderr.log');
  const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
  const code =
    "using System;\nusing System.Diagnostics;\nusing System.IO;\nusing System.Text;\nclass NativeStderrFixture {\n  static string Quote(string s) {\n    var b=new StringBuilder(\"\\\"\");int n=0;\n    foreach(char c in s){if(c=='\\\\')n++;else if(c=='\"'){b.Append('\\\\',n*2+1).Append(c);n=0;}else{b.Append('\\\\',n).Append(c);n=0;}}\n    return b.Append('\\\\',n*2).Append('\"').ToString();\n  }\n  static int Main(string[] args) {\n    var info=new ProcessStartInfo(__BINARY__);\n    info.UseShellExecute=false;info.CreateNoWindow=true;\n    info.RedirectStandardInput=false;info.RedirectStandardOutput=false;info.RedirectStandardError=true;\n    info.WorkingDirectory=Path.GetDirectoryName(info.FileName);\n    var quoted=new string[args.Length];for(int i=0;i<args.Length;i++)quoted[i]=Quote(args[i]);\n    info.Arguments=String.Join(\" \",quoted);\n    try {\n      using(var p=Process.Start(info)){string error=p.StandardError.ReadToEnd();p.WaitForExit();File.AppendAllText(__LOG__,error+\"\\nexit=\"+p.ExitCode+\"\\n\");return p.ExitCode;}\n    }catch(Exception e){File.AppendAllText(__LOG__,e.ToString());return 111;}\n  }\n}\n"
      .replaceAll('__BINARY__', JSON.stringify(nativeBinary))
      .replaceAll('__LOG__', JSON.stringify(wrapperLog));
  await writeFile(wrapperSource, code);
  execFileSync(compiler, ['/nologo', '/target:exe', '/out:' + wrapperExe, wrapperSource], {
    windowsHide: true,
    stdio: 'pipe',
  });
  nativeHostPath = wrapperExe;
}

await writeFile(
  nativeManifest,
  JSON.stringify({
    name: host,
    description: 'Isolated Downloader stream fixture',
    path: nativeHostPath,
    type: 'stdio',
    allowed_extensions: [extId],
  }),
);
await writeFile(
  resolve(data, 'native-allowlist.json'),
  JSON.stringify({ chrome_ids: [], firefox_ids: [extId] }),
);
async function fixtureSource(path) {
  let source = await readFile(path, 'utf8');
  if (process.env.NAV_RPC_TRACE !== '1' || !/[\\/]background\.ts$/.test(path)) return source;
  source = source.replace(
    'async function native(command: string, args?: unknown): Promise<any> {',
    'async function native(command: string, args?: unknown): Promise<any> { try {',
  );
  source = source.replace(
    'if (response?.id !== requestId || response?.version !== 1)',
    '(globalThis as any).__fixtureNativeReplies ??= []; (globalThis as any).__fixtureNativeReplies.push({command,ok:response?.ok,error:response?.error?.message??null,version:response?.version,dataKeys:Object.keys(response?.data??{})}); if (response?.id !== requestId || response?.version !== 1)',
  );
  source = source.replace(
    'return response.data;',
    'return response.data; } catch(error) { (globalThis as any).__fixtureNativeErrors ??= []; (globalThis as any).__fixtureNativeErrors.push({command,error:String(error),stack:(error as any)?.stack}); throw error; }',
  );
  return source;
}
// Build the production entry points. The only source substitution is the isolated native host name.
const sourceRoot = process.cwd();
const compilation = await build({
  absWorkingDir: sourceRoot,
  metafile: true,
  entryPoints: [
    resolve(sourceRoot, 'apps/extension/src/background.ts'),
    resolve(sourceRoot, 'apps/extension/src/resolver.ts'),
  ],
  outdir: ext,
  nodePaths: [resolve(runnerCwd, process.env.NAV_NODE_MODULES ?? 'apps/extension/node_modules')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: JSON.stringify('firefox') },
  plugins: [
    {
      name: 'isolated-fixture-host',
      setup(builder) {
        builder.onLoad(
          { filter: /(?:background|transport|resolver|capture)\.ts$/ },
          async ({ path }) => ({
            contents:
              process.env.NAV_TRACE === '1'
                ? (await fixtureSource(path))
                    .replaceAll('org.downloader.native', host)
                    .replace(
                      'filter.ondata = (event) => {',
                      `filter.onstart = () => { (globalThis.__fixtureFilterEvents ??= []).push({event:'start',at:Date.now(),status:filter.status}); }; filter.ondata = (event) => { (globalThis.__fixtureFilterEvents ??= []).push({event:'data',at:Date.now(),bytes:event.data.byteLength,status:filter.status});`,
                    )
                    .replace(
                      'await sink.chunk(new Uint8Array(event.data));',
                      'await sink.chunk(new Uint8Array(event.data)); (globalThis.__fixtureFilterEvents ??= []).push({event:"chunk_ack",at:Date.now(),offset:sink.offset,status:filter.status});',
                    )
                    .replace(
                      'filter.resume();',
                      'filter.resume(); (globalThis.__fixtureFilterEvents ??= []).push({event:"resumed",at:Date.now(),status:filter.status});',
                    )
                    .replaceAll(
                      '.catch(abort);',
                      '.catch(error => { (globalThis.__fixtureFilterEvents ??= []).push({event:"pipeline_error",at:Date.now(),error:String(error),status:filter.status}); abort(); });',
                    )
                    .replace(
                      'this.open().postMessage(frame);',
                      '(globalThis.__fixtureStreamOperations ??= []).push({event:"operation",at:Date.now(),operation:operation.operation,offset:operation.operation==="chunk"?operation.offset:null}); this.open().postMessage(frame);',
                    )
                    .replace(
                      'const waiter = this.pending.get(response.id);',
                      '(globalThis.__fixtureStreamOperations ??= []).push({event:"ack",at:Date.now(),ok:response.ok,error:response.error?.message??null,offset:response.data?.accepted_offset,terminal:response.data?.terminal}); const waiter = this.pending.get(response.id);',
                    )
                    .replace(
                      'filter.onstop = () => {',
                      `filter.onstop = () => { (globalThis.__fixtureFilterEvents ??= []).push({event:'stop',at:Date.now(),status:filter.status});`,
                    )
                    .replace(
                      'filter.onerror = abort;',
                      `filter.onerror = () => { (globalThis.__fixtureFilterEvents ??= []).push({event:'error',error:filter.error,status:filter.status}); abort(); };`,
                    )
                    .replace(
                      'async function resolverContext(tabId: number, frameId: number, documentId?: string) {',
                      'async function resolverContext(tabId: number, frameId: number, documentId?: string) { console.info("resolver-context-entry",tabId,frameId,documentId);',
                    )
                    .replace(
                      "if (frameId !== 0 || (await browser.tabs.get(tabId)).status !== 'complete') return null;",
                      "const ctxTab = await browser.tabs.get(tabId); console.info('resolver-context-tab',JSON.stringify(ctxTab)); if(frameId !== 0 || ctxTab.status !== 'complete') return null;",
                    )
                    .replace(
                      'if (record.sessionEpoch !== (await browserEpoch)) return null;',
                      "console.info('resolver-context-record',JSON.stringify(record),await browserEpoch); if (record.sessionEpoch !== (await browserEpoch)) return null;",
                    )
                    .replace(
                      'const job = (await browserSnapshot()).jobs.find((job: any) => job.id === entry[0].slice(9));',
                      'const job = (await browserSnapshot()).jobs.find((job: any) => job.id === entry[0].slice(9)); console.info("resolver-context-authority",JSON.stringify({record,job}));',
                    )
                    .replaceAll(
                      '.catch(() => {})',
                      '.catch(error => { (globalThis.__fixtureErrors ??= []).push(String(error)); console.error("fixture resolver error",String(error)); })',
                    )
                : (await fixtureSource(path)).replaceAll('org.downloader.native', host),
            loader: 'ts',
            resolveDir: dirname(path),
          }),
        );
      },
    },
  ],
});
const compilerInputPaths = Object.keys(compilation.metafile.inputs);
for (const input of compilerInputPaths) {
  const actual = resolve(sourceRoot, input);
  const local = relative(sourceRoot, actual);
  const external =
    local === '..' || local.startsWith('..\\') || local.startsWith('../') || isAbsolute(local);
  assert.ok(
    !external || actual.replaceAll('\\', '/').includes('/node_modules/'),
    'Production module escaped intended source root: ' + input,
  );
}
const requiredSourceInputs = [
  'apps/extension/src/background.ts',
  'apps/extension/src/resolver.ts',
  'apps/extension/src/navigation/streams/capture.ts',
];
for (const path of requiredSourceInputs)
  assert.ok(
    compilerInputPaths.some((input) => resolve(sourceRoot, input) === resolve(sourceRoot, path)),
    'Intended production module not compiled: ' + path,
  );
const captureSource = await readFile(
  resolve(sourceRoot, 'apps/extension/src/navigation/streams/capture.ts'),
  'utf8',
);
if (captureSource.includes('let inputEnded = false'))
  assert.ok(
    (await readFile(resolve(ext, 'background.js'), 'utf8')).includes('inputEnded'),
    'Checked EOF guard missing from emitted worker',
  );
const compiledProductionInputs = compilerInputPaths
  .filter((input) => !input.replaceAll('\\', '/').includes('node_modules/'))
  .map((input) => relative(sourceRoot, resolve(sourceRoot, input)).replaceAll('\\', '/'));
await writeFile(
  resolve(dir, 'build-provenance.json'),
  JSON.stringify(
    {
      requestedSourceRevision: sourceRevision,
      compiledSourceRevision: sourceRevision,
      explicitAbsWorkingDir: true,
      absoluteEntryPoints: true,
      verifiedProductionInputs: compiledProductionInputs,
    },
    null,
    2,
  ),
);
if (process.env.NAV_BUILD_ONLY === '1') {
  console.log('PASS intended production source inputs and emitted EOF guard');
  process.exit(0);
}
if (process.env.NAV_RPC_TRACE === '1')
  assert.ok(
    (await readFile(resolve(ext, 'background.js'), 'utf8')).includes('__fixtureNativeReplies'),
    'Native diagnostic hook missing',
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
    name: 'Downloader Firefox production fixture',
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
      'alarms',
      'http://127.0.0.1/*',
    ],
    background: { scripts: ['background.js'], persistent: false },
    options_ui: { page: 'options.html', open_in_tab: true },
  }),
);
const payload = Buffer.alloc(
  Number(process.env.NAV_BYTES ?? (scenario === 'post' ? 8 * 1024 * 1024 + 17 : 262161)),
);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) % 251;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requests = [];
const httpRequests = [];
const server = createServer(async (req, res) => {
  httpRequests.push({ method: req.method, path: req.url });
  if (req.url === '/nav-adapters/g4u/blob') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><meta charset="utf-8"><title>Page-owned Blob</title><a data-nav-fixture-control download=' +
        JSON.stringify(filename) +
        '>Download</a><script>const bytes=new Uint8Array(' +
        payload.length +
        ');for(let i=0;i<bytes.length;i++)bytes[i]=(i*31+7)%251;document.querySelector("a").href=URL.createObjectURL(new Blob([bytes],{type:"application/octet-stream"}));</script>',
    );
    return;
  }
  if (req.url === '/nav-adapters/g4u/xhr') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><meta charset="utf-8"><title>Page-owned XHR form</title><form method="POST" action="/one-use"><input name="token" value="fixture-token"><button data-nav-fixture-control>Download</button></form><script>document.querySelector("form").addEventListener("submit",event=>{event.preventDefault();const form=event.currentTarget;void fetch(form.action,{method:form.method.toUpperCase(),body:new URLSearchParams(new FormData(form))}).then(async response=>{const reader=response.body.getReader();let received=0;try{for(;;){const chunk=await reader.read();if(chunk.done)break;received+=chunk.value.byteLength;}}finally{reader.releaseLock();}document.body.dataset.receivedBytes=String(received);}).catch(error=>{document.body.dataset.fetchError=String(error);});});</script>',
    );
    return;
  }
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
    res.setHeader('Content-Disposition', 'attachment; filename=' + JSON.stringify(filename));
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
const registry = 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\' + host;
execFileSync('reg', ['ADD', registry, '/ve', '/t', 'REG_SZ', '/d', nativeManifest, '/f'], {
  windowsHide: true,
  stdio: 'ignore',
});

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
    'user_pref("browser.download.dir", ' + JSON.stringify(resolve(dir, 'browser-downloads')) + ');',
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
    ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
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
    resolve(parent.ExecutablePath).toLowerCase() !== resolve(executable).toLowerCase()
  )
    return;
  const owned = new Set([browserProc.pid]);
  for (let i = 0; i < all.length; i++)
    for (const p of all) if (owned.has(p.ParentProcessId)) owned.add(p.ProcessId);
  for (const p of all) if (owned.has(p.ProcessId)) identities.set(p.ProcessId, p);
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
  browserProc.stderr.on('data', (data) => ((stderr += data), (firefoxError += data)));
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
    for (const waiter of pending.values()) waiter.reject(Error('Firefox fixture closed'));
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
    capabilities: { alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: false } },
  });
  await send('webExtension.install', { extensionData: { type: 'path', path: ext } });
  for (let attempt = 0; attempt < 200; attempt++) {
    const tree = await send('browsingContext.getTree', {});
    options = tree.contexts.find((item) =>
      item.url.startsWith('moz-extension://' + extensionUuid + '/options.html'),
    );
    if (options) break;
    if (attempt === 199) throw Error('Addon options page unavailable: ' + JSON.stringify(tree));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const evaluate = async (expression) => {
    const result = await send('script.evaluate', {
      expression,
      target: { context: options.context },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (result.type === 'exception') throw Error(JSON.stringify(result.exceptionDetails));
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
  await writeFile(resolve(dir, 'native-probe.json'), JSON.stringify(nativeProbe, null, 2));
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
    execFileSync(cli, ['--json', 'diagnostics'], { env, windowsHide: true, encoding: 'utf8' }),
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
  if (process.env.NAV_PROBE_ONLY === '1') {
    await send('session.end', {});
  } else {
    const added = JSON.parse(
      execFileSync(
        cli,
        ['--json', 'add', base + pagePath, '--navigate', '--paused', '--filename', filename],
        { env, windowsHide: true, encoding: 'utf8' },
      ),
    );
    const jobId = (added.job ?? added).id;
    assert.ok(jobId, JSON.stringify(added));
    if (process.env.NAV_DIRECT_SUBSCRIBE_PROBE === '1') {
      const direct = JSON.parse(
        await evaluate(
          "(async()=>{const local=await browser.storage.local.get();const temporary=browser.storage.session?await browser.storage.session.get():{};const records=Object.keys({...local,...temporary}).filter(k=>k.startsWith('resolver-')||k.startsWith('discovery-'));if(records.length)throw Error('Live records exist; empty scopes would not be actual');if(typeof local.profileId!=='string')throw Error('Actual profile unavailable');try{const reply=await browser.runtime.sendNativeMessage(" +
            JSON.stringify(host) +
            ",{version:1,id:crypto.randomUUID(),command:'browser_subscribe',args:{owner:local.profileId,private:Boolean(browser.extension.inIncognitoContext),scopes:[],after_sequence:null,limit:50}});return JSON.stringify({transportSucceeded:true,version:reply?.version,ok:reply?.ok,error:reply?.error??null,dataKeys:Object.keys(reply?.data??{}),snapshotJobs:reply?.data?.snapshot?.jobs?.length,liveRecordCount:records.length,private:Boolean(browser.extension.inIncognitoContext)})}catch(error){return JSON.stringify({transportSucceeded:false,error:String(error),name:error?.name,liveRecordCount:records.length,private:Boolean(browser.extension.inIncognitoContext)})}})()",
        ),
      );
      await writeFile(resolve(dir, 'direct-subscribe-probe.json'), JSON.stringify(direct, null, 2));
      console.log('Actual-owner direct subscribe probe', JSON.stringify(direct));
      await send('session.end', {});
    } else {
      await evaluate(`browser.runtime.sendMessage({type:'snapshot'})`);
      await evaluate(
        `browser.runtime.sendMessage({type:'navigation_queue_continue',id:${JSON.stringify(jobId)}})`,
      );
      if (scenario === 'blob') {
        let pageContext;
        for (let attempt = 0; attempt < 200; attempt++) {
          const tree = await send('browsingContext.getTree', {});
          pageContext = tree.contexts.find((item) => item.url === base + pagePath);
          if (pageContext) {
            const ready = await send('script.evaluate', {
              expression: '!!document.getElementById("__downloader_adapter_preview")',
              target: { context: pageContext.context },
              awaitPromise: false,
              resultOwnership: 'none',
            });
            if (ready.result?.value === true) break;
          }
          if (attempt === 199) throw Error('Production Blob preview unavailable');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        rememberTree();
        await send('browsingContext.activate', { context: pageContext.context });
        await send('input.performActions', {
          context: pageContext.context,
          actions: [
            {
              type: 'key',
              id: 'blob-preview-keyboard',
              actions: [
                { type: 'keyDown', value: ' ' },
                { type: 'keyUp', value: ' ' },
                { type: 'keyDown', value: '\uE004' },
                { type: 'keyUp', value: '\uE004' },
                { type: 'keyDown', value: '\uE007' },
                { type: 'keyUp', value: '\uE007' },
              ],
            },
          ],
        });
      }
      const deadline = Date.now() + Number(process.env.NAV_DEADLINE_MS ?? 90000);
      let job;
      while (Date.now() < deadline) {
        const listed = JSON.parse(
          execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8' }),
        );
        job = (listed.jobs ?? listed).find((item) => item.id === jobId);
        if (job?.state === 'complete') break;
        if (['failed', 'cancelled'].includes(job?.state))
          throw Error(JSON.stringify({ job, requests }));
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (job?.state !== 'complete') {
        const observation = await evaluate(`(async()=>{
      const tabs=await browser.tabs.query({});
      const local=await browser.storage.local.get();
      const transient=browser.storage.session?await browser.storage.session.get():{};
      const records=Object.entries({...local,...transient}).filter(([key])=>key.startsWith('resolver-')).map(([key,value])=>({key,tabId:value.tabId,scope:value.scope,sourceGeneration:value.sourceGeneration,documentGeneration:value.documentGeneration,sessionEpoch:value.sessionEpoch}));
      const pages=await Promise.all(tabs.filter(tab=>tab.url?.startsWith(${JSON.stringify(base)})).map(async tab=>({id:tab.id,status:tab.status,incognito:tab.incognito,cookieStoreId:tab.cookieStoreId,marker:await browser.tabs.executeScript(tab.id,{frameId:0,code:'({nonce:globalThis.__downloaderDocumentNonce??null,resolver:!!globalThis.__downloaderResolver,errors:globalThis.__fixtureErrors})'}).catch(error=>({error:String(error)}))})));
      return JSON.stringify({sessionStorageAvailable:!!browser.storage.session,records,pages,cookieStores:await browser.cookies.getAllCookieStores(),filterEvents:browser.extension.getBackgroundPage()?.__fixtureFilterEvents,streamOperations:browser.extension.getBackgroundPage()?.__fixtureStreamOperations,nativeReplies:browser.extension.getBackgroundPage()?.__fixtureNativeReplies,nativeErrors:browser.extension.getBackgroundPage()?.__fixtureNativeErrors,errors:browser.extension.getBackgroundPage()?.__fixtureErrors});
    })()`);
        await writeFile(resolve(dir, 'observation.json'), observation);
      }
      assert.equal(
        job?.state,
        'complete',
        JSON.stringify({
          job,
          requests,
          extensionSnapshot: await evaluate(
            `browser.runtime.sendMessage({type:'snapshot'}).then(JSON.stringify)`,
          ),
        }),
      );
      assert.deepEqual(
        requests,
        scenario === 'blob' ? [] : [{ method: 'POST', body: 'token=fixture-token' }],
      );
      if (scenario === 'blob') {
        assert.equal(
          httpRequests.filter((r) => r.path === pagePath && r.method === 'GET').length,
          1,
          'Blob page was refetched',
        );
        assert.ok(
          httpRequests.every(
            (r) => r.method === 'GET' && [pagePath, '/favicon.ico'].includes(r.path),
          ),
          'Unexpected HTTP payload request',
        );
      }
      assert.equal(
        httpRequests.filter((r) => r.path === pagePath && r.method === 'GET').length,
        1,
        'Original page was refetched',
      );
      assert.ok(
        httpRequests.every(
          (r) =>
            (r.method === 'GET' && [pagePath, '/favicon.ico'].includes(r.path)) ||
            (scenario !== 'blob' && r.method === 'POST' && r.path === '/one-use'),
        ),
        'Unexpected HTTP request or payload refetch',
      );
      const bytes = await readFile(resolve(dir, 'downloads', filename));
      assert.equal(bytes.length, payload.length);
      assert.equal(digest(bytes), digest(payload));
      assert.equal(job.verified_sha256, digest(payload));
      const nativeDiagnostics = JSON.parse(
        execFileSync(cli, ['--json', 'diagnostics'], { env, windowsHide: true, encoding: 'utf8' }),
      );
      const sourceFiles = [
        'apps/extension/src/background.ts',
        'apps/extension/src/resolver.ts',
        'apps/extension/src/navigation/streams/blob.ts',
        'apps/extension/src/navigation/streams/capture.ts',
        'apps/extension/src/navigation/streams/transport.ts',
      ];
      const sourceHashes = Object.fromEntries(
        await Promise.all(sourceFiles.map(async (path) => [path, digest(await readFile(path))])),
      );
      const evidence = {
        browser: 'Firefox/' + session.capabilities.browserVersion,
        os: process.platform,
        architecture: process.arch,
        version: JSON.parse(await readFile('package.json', 'utf8')).version,
        nativeVersion: nativeDiagnostics.version,
        nativeBuildRevision,
        nativeHostDiagnostics: hostDiagnostics,
        daemonDiagnostics: {
          version: nativeDiagnostics.version,
          protocol: nativeDiagnostics.protocol,
          platform: nativeDiagnostics.platform,
        },
        sourceRevision,
        compiledSourceRevision: sourceRevision,
        buildProvenance: {
          explicitAbsWorkingDir: true,
          absoluteEntryPoints: true,
          verifiedProductionInputs: compiledProductionInputs,
        },
        sourceHashes,
        extensionBundleHashes: {
          background: digest(await readFile(resolve(ext, 'background.js'))),
          resolver: digest(await readFile(resolve(ext, 'resolver.js'))),
        },
        nativeBinarySha256: digest(await readFile(nativeBinary)),
        cliBinarySha256: digest(await readFile(cli)),
        scenario,
        filename,
        extensionAPI:
          scenario === 'blob'
            ? 'page-owned Blob reader -> owned_blob_stream'
            : 'browser.webRequest.filterResponseData',
        transport: 'persistent browser.runtime.connectNative',
        driver: 'WebDriver BiDi for addon installation and controls; no byte relay',
        diagnosticNativeWrapper: process.env.NAV_NATIVE_STDERR === '1',
        diagnosticSourceChanges: process.env.NAV_TRACE === '1' || process.env.NAV_RPC_TRACE === '1',
        productionBackground: true,
        productionResolver: true,
        submissions: requests.length,
        originalPageOwnedXhr: scenario === 'xhr',
        pageOwnedConsumer:
          scenario === 'xhr' ? 'bounded response.body.getReader drain/discard' : null,
        ordinaryNavigationPostRewritten: false,
        httpRequests,
        httpPayloadRequests: requests.length,
        bytes: bytes.length,
        sha256: digest(bytes),
        nativeVerifiedSha256: job.verified_sha256,
        state: job.state,
        claimGeneration: job.navigation_scope?.claim_generation ?? job.navigation_claim?.generation,
        sourceGeneration: job.source_generation,
        limitations: [
          'Local fixtures; live hosts/accounts pending',
          'Firefox stable only; ESR and other OS rows are separate',
          'Fixture permissions granted in isolated manifest; user permission prompts unqualified',
          'Ordinary binary POST download lane remains pending; Blob cancellation/private/container are separate qualification gates',
        ],
      };
      await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(evidence, null, 2));
      await send('session.end', {});
    }
  }
} catch (error) {
  if (options?.context && process.env.NAV_RPC_TRACE === '1') {
    try {
      const diagnostic = await send('script.evaluate', {
        expression:
          'JSON.stringify({nativeReplies:browser.extension.getBackgroundPage()?.__fixtureNativeReplies,nativeErrors:browser.extension.getBackgroundPage()?.__fixtureNativeErrors})',
        target: { context: options.context },
        awaitPromise: false,
        resultOwnership: 'none',
      });
      await writeFile(
        resolve(dir, 'native-rpc-diagnostic.json'),
        diagnostic.result?.value ?? 'null',
      );
    } catch {}
  }
  await writeFile(
    resolve(dir, 'failure.json'),
    JSON.stringify({ stage: fixtureStage, error: String(error), requests }, null, 2),
  );
  throw error;
} finally {
  for (const waiter of pending.values()) waiter.reject(Error('Firefox fixture finished'));
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
  server.closeAllConnections();
  server.close();
  execFileSync('reg', ['DELETE', registry, '/f'], { windowsHide: true, stdio: 'ignore' });
}
