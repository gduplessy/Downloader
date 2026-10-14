import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, realpath, readdir, copyFile } from 'node:fs/promises';
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
const scenario = 'blob';
const scopeMode = process.env.NAV_RECOVERY_MODE ?? 'cancel';
assert.ok(['cancel', 'revoked-blob', 'reader-loss', 'service-loss', 'browser-loss'].includes(scopeMode));
const payloadBytes = Number(process.env.NAV_RECOVERY_BYTES ?? (8 * 1024 * 1024 + 17));
assert.ok(Number.isSafeInteger(payloadBytes) && payloadBytes >= 1024 * 1024 && payloadBytes <= 64 * 1024 * 1024, 'Bound recovery payload size');
const scopeReport = {
  mode: scopeMode,
  diagnosticSourceChanges: process.env.NAV_TRACE === '1' || process.env.NAV_RPC_TRACE === '1',
  diagnosticNativeWrapper: process.env.NAV_NATIVE_STDERR === '1',
  initialActivation:
    'synthetic invocation of unchanged registered context-menu listener with actual browser.tabs.get metadata',
  nativeContextMenuUiQualified: false,
  rows: [],
  negative: [],
  httpRequests: [],
  scopeProof: [],
  pending: [
    'Native context-menu UI',
    'Firefox ESR',
    'Other OS',
    'Worker-loss/full-browser restart',
    'Ordinary binary main-frame form-navigation response',
  ],
};
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
const dir = resolve('.fixture-streams', 'firefox-recovery-' + Date.now());
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
const suppliedNative = await realpath(resolve(runnerCwd, process.env.NAV_NATIVE_BINARY));
const suppliedCli = await realpath(resolve(runnerCwd, process.env.NAV_CLI_BINARY));
const nativeBinary = resolve(dir, 'downloader-service.exe');
const cli = resolve(dir, 'downloader.exe');
await copyFile(suppliedNative, nativeBinary);
await copyFile(suppliedCli, cli);
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
const scopeHelper = resolve(ext, 'scope-helper.ts');
await writeFile(
  scopeHelper,
  "import browser from 'webextension-polyfill';\nimport {scopeForTab} from __SCOPE_MODULE__;\n(globalThis as any).__scopeFixture = {\n async scope(tabId:number,generation:number){const stored=await browser.storage.local.get('profileId');if(typeof stored.profileId!=='string')throw Error('Actual profile unavailable');return scopeForTab(browser as any,'firefox',stored.profileId,tabId,generation);},\n async activate(tabId:number,url:string){const tab=await browser.tabs.get(tabId);const handlers=(globalThis as any).__fixtureRegisteredMenuHandlers;if(!handlers?.length)throw Error('Registered production menu listener unavailable');for(const handler of handlers)handler({menuItemId:'navigate',linkUrl:url,pageUrl:tab.url},tab);return {handlerCount:handlers.length,tabId:tab.id,cookieStoreId:(tab as any).cookieStoreId,incognito:tab.incognito};}\n};\n".replace(
    '__SCOPE_MODULE__',
    JSON.stringify(resolve(sourceRoot, 'apps/extension/src/navigation/session/scope.ts')),
  ),
);
await writeFile(
  resolve(ext, 'menu-bootstrap.js'),
  "globalThis.__fixtureRegisteredMenuHandlers=[];globalThis.__fixtureScopeErrors=[];const event=browser.contextMenus.onClicked;const original=event.addListener.bind(event);event.addListener=function(listener){globalThis.__fixtureRegisteredMenuHandlers.push(listener);return original(listener)};addEventListener('unhandledrejection',event=>{globalThis.__fixtureScopeErrors.push(String(event.reason));event.preventDefault()});",
);
const compilation = await build({
  absWorkingDir: sourceRoot,
  metafile: true,
  entryPoints: {
    background: resolve(sourceRoot, 'apps/extension/src/background.ts'),
    resolver: resolve(sourceRoot, 'apps/extension/src/resolver.ts'),
    'scope-helper': scopeHelper,
  },
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

const cookieName = 'nav_scope_fixture';
const payloads = Object.fromEntries(
  ['A', 'B', 'C', 'P'].map((label, index) => {
    const bytes = Buffer.alloc(payloadBytes);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * (31 - index * 4) + 7 + index * 13) % 251;
    return [label, bytes];
  }),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expected = Object.fromEntries(
  Object.entries(payloads).map(([label, bytes]) => [label, digest(bytes)]),
);
const requests = [];
const httpRequests = scopeReport.httpRequests;
const server = createServer((req, res) => {
  const variant = /nav_scope_fixture=([ABCP])(?:;|$)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
  httpRequests.push({ method: req.method, path: req.url, variant });
  if (req.url.startsWith('/seed/')) {
    const label = req.url.split('/').at(-1);
    assert.ok(payloads[label]);
    res.setHeader('Set-Cookie', cookieName + '=' + label + '; Path=/; HttpOnly; SameSite=Lax');
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Fixture cookie seed</title>');
    return;
  }
  if (req.url === '/source') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><a href="' + pagePath + '">Resolve the same file</a>');
    return;
  }
  if (req.url === pagePath) {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><meta charset="utf-8"><a data-nav-fixture-control download="scope.bin">Download</a><script>document.documentElement.dataset.fixtureDocument=crypto.randomUUID();fetch("/file").then(response=>{if(!response.ok)throw Error("Missing scoped cookie");return response.blob()}).then(blob=>{document.querySelector("a").href=URL.createObjectURL(blob);document.documentElement.dataset.fixtureBlobReady="true";globalThis.__fixtureBlobReady=true}).catch(error=>{globalThis.__fixtureBlobError=String(error)});</script>',
    );
    return;
  }
  if (req.url === '/file') {
    requests.push({ method: req.method, variant });
    if (!variant) {
      res.writeHead(403);
      res.end('Missing scoped session');
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', payloads[variant].length);
    res.end(payloads[variant]);
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const env = { ...process.env, DOWNLOADER_DATA_DIR: data };
const nativeStartedAt = Date.now();
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
    'user_pref("privacy.userContext.enabled", true);',
    'user_pref("extensions.allowPrivateBrowsingByDefault", true);',
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
let browserProc, ws, options, preparedBrowserStop;
let firefoxError = '';
let browserStartedAt = 0;
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
  const all = processes();
  const exact = (p) =>
    p.CommandLine?.includes(profile) &&
    resolve(p.ExecutablePath).toLowerCase() === resolve(executable).toLowerCase() &&
    Date.parse(p.Created) >= browserStartedAt - 1000;
  const seeds = all.filter(
    (p) => exact(p) && (p.ProcessId === browserProc.pid || p.ParentProcessId === browserProc.pid),
  );
  if (!seeds.length) return;
  const owned = new Set(seeds.map((p) => p.ProcessId));
  for (let i = 0; i < all.length; i++)
    for (const p of all) if (owned.has(p.ParentProcessId)) owned.add(p.ProcessId);
  for (const p of all) if (owned.has(p.ProcessId)) identities.set(p.ProcessId, p);
}

function nativeProcesses(daemonOnly = false) {
  assert.equal(process.platform, 'win32', 'Exact native lifecycle fixture requires Windows');
  const literal = "'" + nativeBinary.replaceAll("'", "''") + "'";
  const script = 'Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq ' + literal + '} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n="Created";e={$_.CreationDate.ToUniversalTime().ToString("o")}} | ConvertTo-Json -Compress';
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:15000});
  const result = raw.trim() ? JSON.parse(raw) : [];
  return (Array.isArray(result) ? result : [result]).filter(item =>
    Date.parse(item.Created) >= nativeStartedAt - 1000 &&
    (!daemonOnly || /(?:^|\s)daemon(?:\s|$)/.test(item.CommandLine ?? '')));
}
function stopNativeIdentity(owned) {
  // Recheck identity in the same PowerShell invocation that stops the exact PID.
  // The copied executable is unique to this fixture and inherits its isolated data directory.
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const script = '$p=Get-CimInstance Win32_Process -Filter "ProcessId=' + owned.ProcessId + '"; if($null -eq $p){exit 0}; if($p.ExecutablePath -ne ' + quote(owned.ExecutablePath) + ' -or $p.CreationDate.ToUniversalTime().ToString("o") -ne ' + quote(owned.Created) + ' -or $p.CommandLine -ne ' + quote(owned.CommandLine) + '){throw "Native process identity changed"}; Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop';
  execFileSync('powershell.exe', ['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], {windowsHide:true,stdio:'pipe',timeout:15000});
}
function stopOwnedNative() {
  if (process.platform !== 'win32') return;
  for (const owned of nativeProcesses()) {
    try { stopNativeIdentity(owned); } catch {}
  }
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
  browserStartedAt = Date.now();
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
  for (let i = 0; i < 600; i++) {
    if (i % 20 === 0) rememberTree();
    ws = new WebSocket('ws://127.0.0.1:' + driverPort + '/session');
    try {
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      break;
    } catch {
      ws.close();
      if (i === 599) throw Error(stderr);
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

  const evaluateJson = async (expression) => JSON.parse(await evaluate(expression));
  const at = async (context, expression) => {
    const result = await send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (result.type === 'exception') throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const list = () => {
    const result = JSON.parse(
      execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8', timeout: 15000 }),
    );
    return result.jobs ?? result;
  };
  const wait = async (check, label, timeout = 120000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw Error(label + ' timed out');
  };
  const actualScope = async (tabId, generation) =>
    evaluateJson(
      'browser.extension.getBackgroundPage().__scopeFixture.scope(' +
        tabId +
        ',' +
        generation +
        ').then(JSON.stringify)',
    );
  const record = async (id) =>
    evaluateJson(
      '(async()=>{const local=await browser.storage.local.get();const temporary=browser.storage.session?await browser.storage.session.get():{};return JSON.stringify({...local,...temporary}[' +
        JSON.stringify('resolver-' + id) +
        ']??null)})()',
    );
  const direct = async (command, args) =>
    evaluateJson(
      '(async()=>{try{const reply=await browser.runtime.sendNativeMessage(' +
        JSON.stringify(host) +
        ',{version:1,id:crypto.randomUUID(),command:' +
        JSON.stringify(command) +
        ',args:' +
        JSON.stringify(args) +
        '});return JSON.stringify({transportSucceeded:true,ok:reply.ok,error:reply.error??null,dataKeys:Object.keys(reply.data??{})})}catch(error){return JSON.stringify({transportSucceeded:false,error:String(error),name:error.name})}})()',
    );
  const contexts = [];
  for (const label of ['A', 'B']) {
    const result = await send('browser.createUserContext', {});
    assert.equal(typeof result.userContext, 'string', 'No actual userContext returned');
    const created = await send('browsingContext.create', {
      type: 'tab',
      userContext: result.userContext,
    });
    await send('browsingContext.navigate', {
      context: created.context,
      url: base + '/seed/' + label,
      wait: 'complete',
    });
    const tabs = await wait(
      async () => {
        const all = await evaluateJson('browser.tabs.query({}).then(JSON.stringify)');
        scopeReport.lastSourceTabMetadata = all.map((tab) => ({
          id: tab.id,
          url: tab.url,
          cookieStoreId: tab.cookieStoreId,
          private: tab.incognito,
        }));
        const matching = all.filter((tab) => tab.url === base + '/seed/' + label);
        assert.ok(matching.length <= 1, 'Actual source tab ambiguity');
        return matching.length ? matching : null;
      },
      'Actual source tab metadata',
      30000,
    );
    const tab = tabs[0];
    assert.equal(typeof tab.cookieStoreId, 'string');
    assert.equal(tab.incognito, false);
    await send('browsingContext.navigate', {
      context: created.context,
      url: base + '/source',
      wait: 'complete',
    });
    contexts.push({
      label,
      userContext: result.userContext,
      context: created.context,
      tabId: tab.id,
      cookieStoreId: tab.cookieStoreId,
      incognito: tab.incognito,
    });
  }
  assert.notEqual(contexts[0].userContext, contexts[1].userContext);
  assert.notEqual(
    contexts[0].cookieStoreId,
    contexts[1].cookieStoreId,
    'BiDi contexts share cookie store',
  );
  const defaultTab = await send('browsingContext.create', { type: 'tab' });
  await send('browsingContext.navigate', {
    context: defaultTab.context,
    url: base + '/seed/C',
    wait: 'complete',
  });
  scopeReport.contexts = contexts.map(({ label, userContext, cookieStoreId, incognito }) => ({
    label,
    userContext,
    cookieStoreId,
    private: incognito,
  }));
  scopeReport.cookieName = cookieName;
  scopeReport.identicalPagePath = pagePath;
  scopeReport.identicalProducerFilePath = '/file';
  scopeReport.blobUrls = 'Per-document object URLs; identical original producer /file endpoint';
  await evaluate(
    'browser.runtime.sendMessage({type:"navigation_scheduler",request:{action:"settings",max_active:1,notifications:false}})',
  );
  const activate = async (context) => {
    const before = new Set(list().map((job) => job.id));
    const activation = await evaluateJson(
      'browser.extension.getBackgroundPage().__scopeFixture.activate(' +
        context.tabId +
        ',' +
        JSON.stringify(base + pagePath) +
        ').then(JSON.stringify)',
    );
    assert.equal(activation.cookieStoreId, context.cookieStoreId);
    assert.equal(activation.tabId, context.tabId);
    scopeReport.scopeProof.push({
      label: context.label,
      sourceCookieStoreId: activation.cookieStoreId,
      initialActivation: 'unchanged registered production listener',
      sourcePrivate: activation.incognito,
    });
    return wait(
      () => list().find((job) => !before.has(job.id) && job.page_url === base + pagePath),
      'New navigation task',
    );
  };
  const resolver = async (job, context) =>
    wait(async () => {
      const stored = await record(job.id);
      if (!stored) return null;
      const tab = await evaluateJson('browser.tabs.get(' + stored.tabId + ').then(JSON.stringify)');
      if (tab.cookieStoreId !== context.cookieStoreId) {
        const error = Error(
          'Resolver substituted ' + tab.cookieStoreId + ' for original ' + context.cookieStoreId,
        );
        error.code = 'actual_container_mismatch';
        scopeReport.queueFailure = {
          expectedCookieStoreId: context.cookieStoreId,
          actualCookieStoreId: tab.cookieStoreId,
          sourceGeneration: stored.sourceGeneration,
          actualNativeScope: list().find((value) => value.id === job.id)?.navigation_scope,
          bytes: list().find((value) => value.id === job.id)?.bytes,
        };
        throw error;
      }
      const markerCode =
        '({tag:document.documentElement.dataset.fixtureDocument,ready:document.documentElement.dataset.fixtureBlobReady==="true",preview:!!document.getElementById("__downloader_adapter_preview")})';
      const markers = await evaluateJson(
        'browser.tabs.executeScript(' +
          stored.tabId +
          ',{frameId:0,code:' +
          JSON.stringify(markerCode) +
          '}).then(JSON.stringify)',
      );
      if (!markers[0]?.ready || !markers[0]?.preview) return null;
      const tree = await send('browsingContext.getTree', {});
      for (const candidate of tree.contexts.filter((item) => item.url === base + pagePath)) {
        const tag = await at(candidate.context, 'document.documentElement.dataset.fixtureDocument');
        if (tag === markers[0].tag) return { stored, tab, context: candidate.context };
      }
      return null;
    }, 'Owned scoped Blob preview');
  const select = async (owned) => {
    await send('browsingContext.activate', { context: owned.context });
    await send('input.performActions', {
      context: owned.context,
      actions: [
        {
          type: 'key',
          id: 'scope-preview-input',
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
  };
  const completed = async (job, context) => {
    const result = await wait(() => {
      const j = list().find((value) => value.id === job.id);
      if (['failed', 'cancelled'].includes(j?.state))
        throw Error('Native terminal failure ' + j.state);
      return j?.state === 'complete' ? j : null;
    }, 'Native scoped completion');
    const bytes = await readFile(result.destination);
    assert.equal(bytes.length, 262161);
    assert.equal(digest(bytes), expected[context.label]);
    assert.equal(result.verified_sha256, expected[context.label]);
    assert.equal(result.navigation_scope.cookie_store_id, context.cookieStoreId);
    assert.equal(result.navigation_scope.container_id, context.cookieStoreId);
    assert.equal(result.navigation_scope.private, false);
    scopeReport.rows.push({
      label: context.label,
      state: result.state,
      bytes: bytes.length,
      sha256: digest(bytes),
      nativeVerifiedSha256: result.verified_sha256,
      filename: result.filename,
      scope: {
        browser: result.navigation_scope.browser,
        cookie_store_id: result.navigation_scope.cookie_store_id,
        container_id: result.navigation_scope.container_id,
        private: result.navigation_scope.private,
        profileHash: digest(Buffer.from(result.navigation_scope.profile)),
        claim_generation: result.navigation_scope.claim_generation,
      },
      sourceGeneration: result.source_generation,
    });
    return result;
  };
  const jobA = await activate(contexts[0]);
  const ownedA = await resolver(jobA, contexts[0]);
  const nativeA = list().find((job) => job.id === jobA.id);
  assert.ok(nativeA.navigation_scope);
  const scopeB = await actualScope(contexts[1].tabId, nativeA.navigation_scope.claim_generation);
  const negative = async (label, scope) => {
    const args = {
      operation: 'begin',
      stream_id: crypto.randomUUID(),
      scope,
      source_generation: nativeA.source_generation,
      target: { kind: 'job', id: jobA.id },
      filename: 'rejected-cross-scope.bin',
      total: 262161,
    };
    if (scope === null) delete args.scope;
    const reply = await direct('browser_stream', args);
    assert.notEqual(reply.ok, true, 'Cross-scope stream admission unexpectedly accepted');
    assert.equal(list().find((job) => job.id === jobA.id).bytes, 0);
    scopeReport.negative.push({ label, reply, zeroNativeBytes: true });
  };
  await negative('actual other container', scopeB);
  await negative('missing scope', null);
  let privateScope = null,
    privateWindow = null;
  try {
    privateWindow = await evaluateJson(
      'browser.windows.create({incognito:true,url:' +
        JSON.stringify(base + '/seed/P') +
        '}).then(JSON.stringify)',
    );
    const tab = privateWindow.tabs?.[0];
    assert.ok(tab?.id, 'Actual private tab not returned');
    privateScope = await actualScope(tab.id, nativeA.navigation_scope.claim_generation);
    assert.equal(privateScope.private, true);
  } catch (error) {
    scopeReport.negative.push({
      label: 'actual private tab',
      qualified: false,
      blockedReason: String(error),
      noFabricatedPrivateScope: true,
    });
  }
  if (privateScope) await negative('actual private tab', privateScope);
  if (privateWindow) await evaluate('browser.windows.remove(' + privateWindow.id + ')');

  let browserStopSignal, browserLossDaemon;
  if (scopeMode === 'browser-loss') {
    // Prepare slow identity scans and the controller before consuming the Blob action.
    rememberTree();
    const daemons = nativeProcesses(true);
    assert.equal(daemons.length, 1, 'Expected one preserved isolated daemon');
    browserLossDaemon = daemons[0];
    browserStopSignal = resolve(dir, 'browser-stop.signal');
    const ready = resolve(dir, 'browser-stop.ready');
    const stopped = resolve(dir, 'browser-stop.json');
    const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
    const owned = JSON.stringify([...identities.values()]);
    const script = '$ErrorActionPreference="Stop"; $owned=ConvertFrom-Json ' + quote(owned) + '; $null=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"; Set-Content -LiteralPath ' + quote(ready) + ' -Value "ready"; while(!(Test-Path -LiteralPath ' + quote(browserStopSignal) + ')){Start-Sleep -Milliseconds 10}; $all=Get-CimInstance Win32_Process -Filter "Name=\'firefox.exe\'"; $stopped=@(); foreach($saved in @($owned)[($owned.Count-1)..0]){$current=$all|Where-Object {$_.ProcessId -eq $saved.ProcessId}; if($null -eq $current){continue}; if($current.CreationDate.ToUniversalTime().ToString("o") -ne $saved.Created -or $current.ExecutablePath -ne $saved.ExecutablePath -or $current.ParentProcessId -ne $saved.ParentProcessId){throw "Prepared browser identity changed"}; Stop-Process -Id $current.ProcessId -Force -ErrorAction SilentlyContinue; $stopped+=@{pid=$saved.ProcessId;created=$saved.Created}}; $stopped|ConvertTo-Json -Compress|Set-Content -LiteralPath ' + quote(stopped);
    preparedBrowserStop = spawn('powershell.exe', ['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,stdio:['ignore','ignore','pipe']});
    let stopError = '';
    preparedBrowserStop.stderr.on('data', bytes => stopError += bytes);
    await wait(async () => {
      if (preparedBrowserStop.exitCode !== null) throw Error('Prepared browser stop failed: '+stopError);
      try { await readFile(ready); return true; } catch(error) { if(error.code !== 'ENOENT') throw error; return false; }
    }, 'Prepared identity-guarded browser stop readiness', 15000);
    scopeReport.browserLossPreparation = {beforeTrustedSelection:true, controllerPid:preparedBrowserStop.pid,
      browserIdentities:[...identities.values()].map(item=>({pid:item.ProcessId,parentPid:item.ParentProcessId,created:item.Created}))};
  }
  const startedAt = Date.now();
  if (scopeMode === 'revoked-blob')
    await at(ownedA.context, 'URL.revokeObjectURL(document.querySelector("a").href)');
  await select(ownedA);
  let progress = list().find(job => job.id === jobA.id);
  if (scopeMode !== 'revoked-blob') {
    progress = await wait(() => {
      const current = list().find(job => job.id === jobA.id);
      assert.notEqual(current.state, 'complete', 'Recovery control was too late');
      return current.bytes > 0 && current.bytes < payloadBytes ? current : null;
    }, 'Durable original Blob partial progress');
    scopeReport.control = {mode: scopeMode, bytesBefore: progress.bytes, originalTotal: payloadBytes};
    if (scopeMode === 'cancel')
      await evaluate('browser.runtime.sendMessage({type:"cancel_capture",id:' + JSON.stringify(jobA.id) + '})');
    else if (scopeMode === 'reader-loss')
      await send('browsingContext.close', {context: ownedA.context});
    else if (scopeMode === 'browser-loss') {
      assert.equal(pending.size, 0, 'Do not terminate fixture browser with pending BiDi commands');
      const preserved = browserLossDaemon;
      scopeReport.control.terminatedBrowserIdentities = scopeReport.browserLossPreparation.browserIdentities;
      scopeReport.control.preservedDaemonIdentity = {pid:preserved.ProcessId, created:preserved.Created};
      fixtureStage = 'verified browser process loss';
      scopeReport.control.stopRequestedAt = new Date().toISOString();
      await writeFile(browserStopSignal, 'stop');
      await wait(() => preparedBrowserStop.exitCode !== null, 'Prepared browser controller exit', 15000);
      assert.equal(preparedBrowserStop.exitCode, 0, 'Identity-guarded browser stop failed');
      scopeReport.control.stopCompletedAt = new Date().toISOString();
      await wait(() => !processes().some(item => identities.get(item.ProcessId)?.Created === item.Created),
        'Verified fixture browser tree exit', 15000);
      await wait(() => nativeProcesses().every(item => /(?:^|\s)daemon(?:\s|$)/.test(item.CommandLine ?? '')),
        'Verified fixture native-host exit', 15000);
      assert.ok(nativeProcesses(true).some(item => item.ProcessId === preserved.ProcessId && item.Created === preserved.Created),
        'Browser-loss gate must preserve original daemon');
      scopeReport.control.browserAndNativeHostsExited = true;
      scopeReport.control.waitDeadlineMs = 120000;
      scopeReport.control.noBrowserRestartOrEpochMutation = true;
      ws?.close();
    }
    else if (scopeMode === 'service-loss') {
      // CLI/native messaging can start a replacement daemon; the initial ChildProcess
      // may already have exited. Select the actual live daemon, not that stale handle.
      const live = nativeProcesses(true);
      assert.equal(live.length, 1, 'Expected exactly one live daemon for isolated copied executable');
      const owned = live[0];
      scopeReport.control.daemonIdentity = {pid: owned.ProcessId, created: owned.Created,
        executable: nativeBinary, dataDirectory: data, commandLine: owned.CommandLine};
      stopNativeIdentity(owned);
      await wait(() => !nativeProcesses().some(current => current.ProcessId === owned.ProcessId && current.Created === owned.Created), 'Verified owned daemon exit', 15000);
      scopeReport.control.terminatedOwnDaemon = true;
      // Give the real connected browser stream time to observe the disconnected service.
      // Subsequent ordinary CLI/native calls may restart the service through ensure_service.
      await new Promise(resolve => setTimeout(resolve, 1000));
      await wait(() => {
        try { return list().length > 0; } catch { return false; }
      }, 'Isolated service restart and persistent job readiness', 30000);
      const restarted = nativeProcesses(true);
      assert.equal(restarted.length, 1, 'Expected one replacement isolated daemon');
      assert.ok(restarted[0].ProcessId !== owned.ProcessId || restarted[0].Created !== owned.Created,
        'Service loss did not replace daemon identity');
      scopeReport.control.restartedDaemonIdentity = {pid: restarted[0].ProcessId, created: restarted[0].Created};
    }
  } else scopeReport.control = {mode: scopeMode, revokedActualPageBlob: true};
  const readRecoveryMarkers = async (nativeScope = nativeA.navigation_scope) => evaluateJson(
    '(async()=>{const local=await browser.storage.local.get();const temporary=browser.storage.session?await browser.storage.session.get():{};const key=' + JSON.stringify(jobA.id) + ';const nativeScope=' + JSON.stringify(nativeScope) + ';const pick=(all,prefix)=>all[prefix+key]??null;const safe=record=>record?{state:record.state??null,tabId:record.tabId??null,sourceGeneration:record.sourceGeneration??null,documentGeneration:record.documentGeneration??null,kind:record.kind??null,hasDocumentNonce:typeof record.documentNonce==="string",hasStreamId:typeof record.streamId==="string",scope:record.scope?{browser:record.scope.browser,cookie_store_id:record.scope.cookie_store_id,container_id:record.scope.container_id,private:record.scope.private,claim_generation:record.scope.claim_generation}:null}:null;const merged={...local,...temporary};const resolver=pick(merged,"resolver-"),capture=pick(merged,"capture-");const sameScope=(left,right)=>!!left&&!!right&&["browser","profile","private","cookie_store_id","container_id","partition_key","claim_generation"].every(field=>JSON.stringify(left[field])===JSON.stringify(right[field]));return JSON.stringify({capture:safe(capture),captureScopeMatchesNative:sameScope(capture?.scope,nativeScope),sessionAreaAvailable:!!browser.storage.session,local:{resolver:safe(pick(local,"resolver-")),capture:safe(pick(local,"capture-"))},session:{resolver:safe(pick(temporary,"resolver-")),capture:safe(pick(temporary,"capture-"))},documentNonceEquivalent:!!resolver&&!!capture&&typeof resolver.documentNonce==="string"&&resolver.documentNonce===capture.documentNonce})})()',
  );
  let interrupted;
  try {
    interrupted = await wait(async () => {
    const current = list().find(job => job.id === jobA.id);
    scopeReport.lastInterruptionObservation = {state: current?.state ?? null,
      bytes: current?.bytes ?? null, total: current?.total ?? null,
      sourceGeneration: current?.source_generation ?? null,
      verifiedSha256: current?.verified_sha256 ?? null,
      hasError: typeof current?.error === 'string' && current.error.length > 0};
    assert.notEqual(current.state, 'complete', 'Interrupted original Blob was published');
    if (current.state !== 'waiting_user') return null;
    if (scopeMode === 'browser-loss') {
      scopeReport.interruptionAdmissionObserved = {nativeState:current.state,
        sourceGeneration:current.source_generation, afterVerifiedBrowserExit:true};
      return current;
    }
    // The adapter preview is already WaitingUser before asynchronous selection commits.
    // Wait for the actual production stream marker, not that earlier preview state.
    const markers = await readRecoveryMarkers(current.navigation_scope);
    scopeReport.lastInterruptionMarkers = markers;
    const actualCapture = markers.capture;
    if (actualCapture?.state !== 'interrupted' || !actualCapture.hasStreamId
        || actualCapture.tabId !== ownedA.tab.id
        || actualCapture.sourceGeneration !== current.source_generation
        || !markers.captureScopeMatchesNative
        || (scopeMode === 'revoked-blob' && !markers.documentNonceEquivalent)) return null;
    scopeReport.interruptionAdmissionObserved = {nativeState: current.state,
      captureState: actualCapture.state, exactNativeScope: true,
      sourceGeneration: actualCapture.sourceGeneration,
      documentNonceEquivalent: markers.documentNonceEquivalent};
    return current;
    }, 'Native original stream interruption', 120000);
  } catch (error) {
    if (scopeMode === 'browser-loss') {
      // Read the actual retained checkpoint and bytes without creating a browser/reader.
      const current = list().find(job => job.id === jobA.id);
      const query = 'import sqlite3,json,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); rows=[json.loads(row[0]) for row in c.execute("SELECT data FROM records WHERE kind=?",("browser_stream",))]; print(json.dumps([{"offset":r.get("offset"),"total":r.get("total"),"terminal":r.get("terminal"),"sourceGeneration":r.get("identity",{}).get("source_generation")} for r in rows if r.get("job_id")==sys.argv[2]]))';
      const checkpoints = JSON.parse(execFileSync('python', ['-c',query,resolve(data,'downloader.db').replaceAll('\\','/'),jobA.id],
        {windowsHide:true,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}));
      let retained = null, publishedBytes = null;
      try { retained = await readFile(resolve(dirname(current.destination), '.' + current.filename + '.' + current.id + '.part')); }
      catch(readError) { if(readError.code !== 'ENOENT') throw readError; }
      try { publishedBytes = await readFile(current.destination); } catch(readError) { if(readError.code !== 'ENOENT') throw readError; }
      scopeReport.browserLossNegative = {state:current.state, bytes:current.bytes,
        sourceGeneration:current.source_generation, verifiedSha256:current.verified_sha256,
        checkpoints, partialLength:retained?.length ?? null, partialSha256:retained ? digest(retained) : null,
        intendedPrefixSha256:retained ? digest(payloads.A.subarray(0,retained.length)) : null,
        publishedLength:publishedBytes?.length ?? null, publishedSha256:publishedBytes ? digest(publishedBytes) : null,
        controlTooLate:current.state === 'complete', noPublication:publishedBytes === null, originalGetCount:requests.filter(request=>request.variant==='A').length,
        otherGetCount:requests.filter(request=>request.variant!=='A').length,
        waitDeadlineMs:120000, noBrowserRestartOrEpochMutation:true};
      scopeReport.originalSourceTabsRetained = false;
      throw error;
    }
    try { scopeReport.interruptionTimeoutMarkers = await readRecoveryMarkers(); }
    catch { scopeReport.interruptionTimeoutMarkersUnavailable = true; }
    throw error;
  }
  assert.equal(interrupted.verified_sha256, null);
  assert.equal(interrupted.navigation_scope.cookie_store_id, contexts[0].cookieStoreId);
  assert.equal(interrupted.source_generation, nativeA.source_generation);
  assert.ok(interrupted.bytes < payloadBytes);
  if (scopeMode !== 'revoked-blob') assert.ok(interrupted.bytes >= progress.bytes);
  else assert.equal(interrupted.bytes, 0);
  const partialPath = resolve(dirname(interrupted.destination), '.' + interrupted.filename + '.' + interrupted.id + '.part');
  // A real admitted native Blob stream owns a staging file, even at zero bytes.
  const partial = await readFile(partialPath);
  assert.equal(partial.length, interrupted.bytes);
  assert.equal(digest(partial), digest(payloads.A.subarray(0, partial.length)));
  await assert.rejects(readFile(interrupted.destination), error => error.code === 'ENOENT');
  await new Promise(resolve => setTimeout(resolve, 1500));
  const settled = list().find(job => job.id === jobA.id);
  const recoveryMarkers = scopeMode === 'browser-loss' ? {browserExited:true} : await readRecoveryMarkers();
  scopeReport.settledDiagnostic = {
    native: { state: settled.state, bytes: settled.bytes, total: settled.total,
      sourceGeneration: settled.source_generation, verifiedSha256: settled.verified_sha256,
      hasError: typeof settled.error === 'string' && settled.error.length > 0,
      errorCode: typeof settled.error === 'string' ? /^[a-z_]{1,64}:/.exec(settled.error)?.[0].slice(0, -1) ?? null : null,
      navigationScope: settled.navigation_scope ? {browser: settled.navigation_scope.browser,
        cookie_store_id: settled.navigation_scope.cookie_store_id, container_id: settled.navigation_scope.container_id,
        private: settled.navigation_scope.private, claim_generation: settled.navigation_scope.claim_generation} : null},
    markers: recoveryMarkers,
  };
  assert.equal(settled.bytes, interrupted.bytes, 'Late reader mutated interrupted progress');
  assert.equal(settled.state, 'waiting_user');
  assert.equal(settled.verified_sha256, null);
  assert.equal(requests.filter(request => request.variant === 'A').length, 1);
  assert.equal(requests.filter(request => request.variant !== 'A').length, 0);
  if (scopeMode === 'browser-loss') scopeReport.originalSourceTabsRetained = false;
  else {
    const sourceA = await evaluateJson('browser.tabs.get(' + contexts[0].tabId + ').then(JSON.stringify)');
    assert.equal(sourceA.cookieStoreId, contexts[0].cookieStoreId);
    scopeReport.originalSourceTabsRetained = true;
  }
  scopeReport.recovery = {state: settled.state, bytes: settled.bytes, originalBytes: payloadBytes,
    partialSha256: digest(partial), intendedPrefixSha256: digest(payloads.A.subarray(0, partial.length)),
    sourceGeneration: settled.source_generation, verifiedSha256: settled.verified_sha256,
    recoveryMessage: settled.error, noPublication: true, noRefetch: true, lateProgressUnchanged: true,
    elapsedMs: Date.now()-startedAt};
  const sourceFiles = [
    'apps/extension/src/background.ts',
    'apps/extension/src/resolver.ts',
    'apps/extension/src/navigation/session/scope.ts',
    'apps/extension/src/navigation/session/source.ts',
    'apps/extension/src/navigation/streams/blob.ts',
    'apps/extension/src/navigation/streams/transport.ts',
  ];
  scopeReport.sourceHashes = Object.fromEntries(
    await Promise.all(sourceFiles.map(async (path) => [path, digest(await readFile(path))])),
  );
  scopeReport.bundleHashes = {
    background: digest(await readFile(resolve(ext, 'background.js'))),
    resolver: digest(await readFile(resolve(ext, 'resolver.js'))),
    scopeHelper: digest(await readFile(resolve(ext, 'scope-helper.js'))),
  };
  scopeReport.productionCompiledInputs = compiledProductionInputs.filter(path => !path.startsWith('.fixture-streams/'));
  scopeReport.sourceRevision = sourceRevision;
  scopeReport.compiledSourceRevision = sourceRevision;
  scopeReport.fixtureSha256 = digest(await readFile(new URL(import.meta.url)));
  scopeReport.buildProvenance = { explicitAbsWorkingDir: true, absoluteEntryPoints: true, verifiedProductionInputs: scopeReport.productionCompiledInputs };
  scopeReport.nativeBuildRevision = nativeBuildRevision;
  scopeReport.productVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
  scopeReport.nativeVersion = hostDiagnostics.version;
  scopeReport.nativeBinarySha256 = digest(await readFile(nativeBinary));
  scopeReport.cliBinarySha256 = digest(await readFile(cli));
  scopeReport.browser = 'Firefox/' + session.capabilities.browserVersion;
  scopeReport.os = process.platform;
  scopeReport.state = 'qualified';
  scopeReport.driverByteRelay = false;
  scopeReport.nativePayloadRefetch = false;
  scopeReport.syntheticScope = false;
  scopeReport.privatePositiveLaneQualified = false;
  await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(scopeReport, null, 2));
  console.log(JSON.stringify(scopeReport, null, 2));
  if (scopeMode !== 'browser-loss') await send('session.end', {});
} catch (error) {
  if (scopeMode !== 'browser-loss' && options?.context && process.env.NAV_RPC_TRACE === '1') {
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
    JSON.stringify(
      {
        stage: fixtureStage,
        error: String(error),
        code: error.code ?? null,
        sourceRevision,
        nativeBuildRevision,
        scopeReport,
        requests,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  for (const waiter of pending.values()) waiter.reject(Error('Firefox fixture finished'));
  pending.clear();
  ws?.close();
  await writeFile(resolve(dir, 'owned-firefox-stderr.log'), firefoxError);
  await writeFile(resolve(dir, 'owned-daemon-stderr.log'), daemonError);
  if (preparedBrowserStop?.exitCode === null) preparedBrowserStop.kill();
  preparedBrowserStop?.stderr.destroy();
  preparedBrowserStop?.unref();
  stopOwnedTree();
  browserProc?.kill();
  browserProc?.stderr.destroy();
  browserProc?.unref();
  daemon.kill();
  stopOwnedNative();
  daemon.stderr.destroy();
  daemon.unref();
  server.closeAllConnections();
  server.close();
  execFileSync('reg', ['DELETE', registry, '/f'], { windowsHide: true, stdio: 'ignore' });
}
