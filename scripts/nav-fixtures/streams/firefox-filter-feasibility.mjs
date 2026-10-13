// API feasibility only: no native desktop acceptance or driver byte relay.
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const lane = process.argv[2] ?? 'main_frame';
assert.ok(['main_frame', 'xmlhttprequest'].includes(lane), 'Select main_frame or xmlhttprequest');
const executable = process.env.NAV_BROWSER ?? 'C:/Program Files/Mozilla Firefox/firefox.exe';
const root = resolve('.fixture-streams', 'firefox-filter-' + randomUUID());
const profile = resolve(root, 'profile'),
  extension = resolve(root, 'extension');
await mkdir(profile, { recursive: true });
await mkdir(extension, { recursive: true });
const extensionId = 'filter-feasibility-' + randomUUID() + '@local',
  extensionUuid = randomUUID();
const bytes = 8 * 1024 * 1024 + 17,
  payload = Buffer.alloc(bytes, 65),
  requests = [];
const payloadKind = process.env.NAV_PAYLOAD ?? 'ascii';
assert.ok(['ascii', 'binary'].includes(payloadKind));
if (payloadKind === 'binary')
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) % 251;
const nosniff = process.env.NAV_NOSNIFF === '1';
let observation;
const server = createServer(async (req, res) => {
  if (req.url === '/page') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<form method="POST" action="/one-use"><input name="token" value="fixture-token"><button>Download</button></form>',
    );
  } else if (req.url === '/one-use') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, body: Buffer.concat(chunks).toString() });
    if (requests.length !== 1 || req.method !== 'POST') {
      res.writeHead(410);
      res.end('consumed');
      return;
    }
    res.setHeader('Content-Type', 'text/plain');
    if (nosniff) res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', bytes);
    await new Promise((r) => setTimeout(r, 500));
    res.end(payload);
  } else if (req.url === '/metadata') {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 16384) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    observation = JSON.parse(Buffer.concat(chunks).toString());
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const action =
  lane === 'main_frame'
    ? 'document.querySelector("form").submit()'
    : 'void fetch(document.querySelector("form").action,{method:"POST",body:new URLSearchParams({token:"fixture-token"})})';
const addon = [
  'const base=' + JSON.stringify(base) + ', action=' + JSON.stringify(action) + ';',
  'const stats={bytes:0,events:[]};',
  'const report=()=>fetch(base+"/metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(stats)}).catch(()=>{});',
  'browser.runtime.onInstalled.addListener(()=>browser.runtime.openOptionsPage());',
  'browser.runtime.onMessage.addListener(message=>{if(message.type!=="arm")return;setTimeout(async()=>{try{',
  'const tab=await browser.tabs.create({url:base+"/page"});for(let i=0;i<100;i++){if((await browser.tabs.get(tab.id)).status==="complete")break;await new Promise(r=>setTimeout(r,50))}',
  'await browser.tabs.executeScript(tab.id,{code:action});',
  '}catch(error){stats.events.push({event:"submission-error",error:String(error)});report()}},1500);return Promise.resolve(true)});',
  'browser.webRequest.onBeforeRequest.addListener(details=>{if(details.url!==base+"/one-use")return;',
  'stats.events.push({event:"request",requestId:details.requestId,type:details.type,method:details.method});',
  'const filter=browser.webRequest.filterResponseData(details.requestId);',
  'filter.onstart=()=>stats.events.push({event:"start"});',
  'filter.ondata=event=>{stats.bytes+=event.data.byteLength;filter.write(event.data)};',
  'filter.onstop=()=>{filter.close();stats.events.push({event:"stop"});report()};',
  'filter.onerror=()=>{stats.events.push({event:"error",error:filter.error});report()};',
  '},{urls:["http://127.0.0.1/*"]},["blocking"]);',
].join('\n');
await writeFile(resolve(extension, 'background.js'), addon);
await writeFile(
  resolve(extension, 'options.html'),
  '<!doctype html><title>Isolated filter probe</title>',
);
await writeFile(
  resolve(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 2,
    name: 'Firefox filter feasibility',
    version: '0.1.0',
    browser_specific_settings: { gecko: { id: extensionId, strict_min_version: '115.0' } },
    background: { scripts: ['background.js'], persistent: true },
    permissions: ['tabs', 'webRequest', 'webRequestBlocking', 'http://127.0.0.1/*'],
    options_ui: { page: 'options.html', open_in_tab: true },
  }),
);
await writeFile(
  resolve(profile, 'user.js'),
  [
    'user_pref("browser.shell.checkDefaultBrowser",false);',
    'user_pref("browser.startup.page",0);',
    'user_pref("extensions.webextensions.uuids",' +
      JSON.stringify(JSON.stringify({ [extensionId]: extensionUuid })) +
      ');',
  ].join('\n'),
);
const { createServer: createPortServer } = await import('node:net');
const portServer = createPortServer();
await new Promise((r) => portServer.listen(0, '127.0.0.1', r));
const port = portServer.address().port;
await new Promise((r) => portServer.close(r));
let child,
  socket,
  browserVersion,
  seq = 0;
const pending = new Map(),
  identities = new Map();
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
  if (process.platform !== 'win32' || !child?.pid) return;
  const all = processes(),
    parent = all.find((p) => p.ProcessId === child.pid);
  if (
    !parent?.CommandLine?.includes(profile) ||
    resolve(parent.ExecutablePath).toLowerCase() !== resolve(executable).toLowerCase()
  )
    return;
  const owned = new Set([child.pid]);
  for (let i = 0; i < all.length; i++)
    for (const p of all) if (owned.has(p.ParentProcessId)) owned.add(p.ProcessId);
  for (const p of all) if (owned.has(p.ProcessId)) identities.set(p.ProcessId, p);
}
function stopOwnedTree() {
  if (process.platform !== 'win32') {
    child?.kill();
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
  const parent = owned.find((p) => p.ProcessId === child?.pid && p.CommandLine?.includes(profile));
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
    const id = ++seq,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(method + ' timed out'));
      }, 30000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
try {
  child = spawn(
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
    { windowsHide: true, stdio: 'ignore' },
  );
  for (let i = 0; i < 200; i++) {
    socket = new WebSocket('ws://127.0.0.1:' + port + '/session');
    try {
      await new Promise((r, j) => {
        socket.onopen = r;
        socket.onerror = j;
      });
      break;
    } catch {
      socket.close();
      if (i === 199) throw Error('Owned Firefox endpoint unavailable');
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  rememberTree();
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id === undefined) return;
    const waiter = pending.get(event.id);
    pending.delete(event.id);
    event.type === 'error'
      ? waiter?.reject(Error(JSON.stringify(event)))
      : waiter?.resolve(event.result);
  };
  const session = await send('session.new', {
    capabilities: { alwaysMatch: { browserName: 'firefox' } },
  });
  browserVersion = session.capabilities.browserVersion;
  await send('webExtension.install', { extensionData: { type: 'path', path: extension } });
  let options;
  for (let i = 0; i < 200; i++) {
    const tree = await send('browsingContext.getTree');
    options = tree.contexts.find((c) =>
      c.url.startsWith('moz-extension://' + extensionUuid + '/options.html'),
    );
    if (options) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(options, 'Owned extension options page unavailable');
  rememberTree();
  const armed = await send('script.evaluate', {
    expression: 'browser.runtime.sendMessage({type:"arm"})',
    target: { context: options.context },
    awaitPromise: true,
    resultOwnership: 'none',
  });
  assert.notEqual(armed.type, 'exception');
  socket.close(); // Addon owns the request; no subsequent driver calls.
  for (let i = 0; i < 200 && !observation; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(observation, 'No filter metadata before deadline');
  assert.deepEqual(requests, [{ method: 'POST', body: 'token=fixture-token' }]);
  assert.equal(observation.events.find((e) => e.event === 'request')?.type, lane);
  const report = {
    browser: 'Firefox/' + browserVersion,
    os: process.platform,
    architecture: process.arch,
    lane,
    event: 'onBeforeRequest',
    response: 'inline text/plain; 500ms delay',
    driverDisconnectedBeforeSubmission: true,
    originalPostCount: requests.length,
    bytesExpected: bytes,
    payloadKind,
    nosniff,
    contentType: 'text/plain',
    contentDisposition: null,
    observation,
    nativeDesktopAcceptance: false,
    responseBytesRelayedByDriver: false,
    limitations: [
      'Addon-only feasibility; original navigation and fetch are distinct lanes',
      'No production native stream, live host, private/container or cross-platform claim',
    ],
  };
  await writeFile(resolve(root, 'feasibility.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const waiter of pending.values()) waiter.reject(Error('Owned fixture finished'));
  pending.clear();
  socket?.close();
  stopOwnedTree();
  child?.unref();
  server.closeAllConnections();
  server.close();
}
