import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../../apps/extension/package.json', import.meta.url));
const { build } = require('esbuild');
const executable =
  process.env.NAV_BROWSER || 'C:/Program Files/Mozilla Firefox/firefox.exe';
const dir = resolve('.fixture-streams', 'firefox-production-' + Date.now());
const ext = resolve(dir, 'extension');
const data = resolve(dir, 'service');
await mkdir(ext, { recursive: true });
await mkdir(data, { recursive: true });
const extId = 'downloader-nav-fixture-' + crypto.randomUUID() + '@local';
const extensionUuid = crypto.randomUUID();
const host = 'org.downloader.fixture_' + crypto.randomUUID().replaceAll('-', '');
const nativeBinary = resolve('target/debug/downloader-service.exe');
const cli = resolve('target/debug/downloader.exe');
const nativeManifest = resolve(dir, 'native.json');
await writeFile(
  nativeManifest,
  JSON.stringify({
    name: host,
    description: 'Isolated Downloader stream fixture',
    path: nativeBinary,
    type: 'stdio',
    allowed_extensions: [extId],
  }),
);
await writeFile(
  resolve(data, 'native-allowlist.json'),
  JSON.stringify({ chrome_ids: [], firefox_ids: [extId] }),
);
// Build the production entry points. The only source substitution is the isolated native host name.
await build({
  entryPoints: ['apps/extension/src/background.ts', 'apps/extension/src/resolver.ts'],
  outdir: ext,
  nodePaths: [resolve('apps/extension/node_modules')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { BROWSER: JSON.stringify('firefox') },
  plugins: [
    {
      name: 'isolated-fixture-host',
      setup(builder) {
        builder.onLoad({ filter: /(?:background|transport|resolver|capture)\.ts$/ }, async ({ path }) => ({
          contents: process.env.NAV_TRACE === '1' ? (await readFile(path, 'utf8'))
            .replaceAll('org.downloader.native', host)
            .replace('filter.ondata = (event) => {', `filter.onstart = () => { (globalThis.__fixtureFilterEvents ??= []).push({event:'start',status:filter.status}); }; filter.ondata = (event) => { (globalThis.__fixtureFilterEvents ??= []).push({event:'data',bytes:event.data.byteLength,status:filter.status});`)
            .replace('filter.onstop = () => {', `filter.onstop = () => { (globalThis.__fixtureFilterEvents ??= []).push({event:'stop',status:filter.status});`)
            .replace('filter.onerror = abort;', `filter.onerror = () => { (globalThis.__fixtureFilterEvents ??= []).push({event:'error',error:filter.error,status:filter.status}); abort(); };`)
            .replace(
              'async function resolverContext(tabId: number, frameId: number, documentId?: string) {',
              'async function resolverContext(tabId: number, frameId: number, documentId?: string) { console.info("resolver-context-entry",tabId,frameId,documentId);',
            )
            .replace("if (frameId !== 0 || (await browser.tabs.get(tabId)).status !== 'complete') return null;", "const ctxTab = await browser.tabs.get(tabId); console.info('resolver-context-tab',JSON.stringify(ctxTab)); if(frameId !== 0 || ctxTab.status !== 'complete') return null;")
            .replace("if (record.sessionEpoch !== (await browserEpoch)) return null;", "console.info('resolver-context-record',JSON.stringify(record),await browserEpoch); if (record.sessionEpoch !== (await browserEpoch)) return null;")
            .replace(
              'const job = (await browserSnapshot()).jobs.find((job: any) => job.id === entry[0].slice(9));',
              'const job = (await browserSnapshot()).jobs.find((job: any) => job.id === entry[0].slice(9)); console.info("resolver-context-authority",JSON.stringify({record,job}));',
            )
            .replaceAll(
              '.catch(() => {})',
              '.catch(error => { (globalThis.__fixtureErrors ??= []).push(String(error)); console.error("fixture resolver error",String(error)); })',
            ) : (await readFile(path, 'utf8')).replaceAll('org.downloader.native', host),
          loader: 'ts',
        }));
      },
    },
  ],
});
await writeFile(resolve(ext, 'options.html'), '<script src="wake.js"></script>');
await writeFile(
  resolve(ext, 'wake.js'),
  'setInterval(()=>browser.runtime.sendMessage({type:"fixture_ping"}).catch(()=>{}),500)',
);
await writeFile(resolve(ext, 'manifest.json'), JSON.stringify({
  manifest_version: 2, name: 'Downloader Firefox production fixture', version: '0.1.0',
  browser_specific_settings: { gecko: { id: extId, strict_min_version: '115.0' } },
  permissions: ['nativeMessaging','cookies','tabs','storage','webRequest','webRequestBlocking','downloads','contextMenus','alarms','http://127.0.0.1/*'],
  background: { scripts: ['background.js'], persistent: false },
  options_ui: { page: 'options.html', open_in_tab: true },
}));
const payload = Buffer.alloc(Number(process.env.NAV_BYTES ?? 8 * 1024 * 1024 + 17));
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) % 251;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requests = [];
const server = createServer(async (req, res) => {
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
    res.setHeader('Content-Disposition', 'attachment; filename="original-post.bin"');
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
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const driverPort = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const profile = resolve(dir, 'profile');
await mkdir(profile, { recursive: true });
await writeFile(resolve(profile, 'user.js'), [
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("browser.startup.page", 0);',
  'user_pref("browser.download.folderList", 2);',
  'user_pref("browser.download.dir", ' + JSON.stringify(resolve(dir,'browser-downloads')) + ');',
  'user_pref("browser.download.useDownloadDir", true);',
  'user_pref("remote.active-protocols", 1);',
  'user_pref("extensions.webextensions.uuids", ' + JSON.stringify(JSON.stringify({[extId]: extensionUuid})) + ');',
].join('\n'));
let browserProc, ws;
let seq=0;
let fixtureStage="startup";
const pending=new Map();
const send=(method,params={})=>new Promise((resolve,reject)=>{
  fixtureStage=method;
  const id=++seq;
  const timeout=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'))},45000);
  pending.set(id,{resolve:(value)=>{clearTimeout(timeout);resolve(value)},reject:(error)=>{clearTimeout(timeout);reject(error)}});
  ws.send(JSON.stringify({id,method,params}));
});
try {
  browserProc=spawn(executable,['-headless','-no-remote','-profile',profile,'-remote-allow-system-access','--remote-debugging-port',String(driverPort)],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr='';browserProc.stderr.on('data',data=>stderr+=data);
  for(let i=0;i<200;i++){
    ws=new WebSocket('ws://127.0.0.1:'+driverPort+'/session');
    try{await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});break}
    catch{ws.close();if(i===199)throw Error(stderr);await new Promise(resolve=>setTimeout(resolve,100))}
  }
  ws.onclose=()=>{for(const waiter of pending.values())waiter.reject(Error('Firefox fixture closed'));pending.clear()};
  ws.onmessage=({data})=>{const event=JSON.parse(data);if(event.id===undefined)return;const waiter=pending.get(event.id);pending.delete(event.id);event.type==='error'?waiter?.reject(Error(JSON.stringify(event))):waiter?.resolve(event.result)};
  const session=await send('session.new',{capabilities:{alwaysMatch:{browserName:'firefox',acceptInsecureCerts:false}}});
  await send('webExtension.install',{extensionData:{type:'path',path:ext}});
  let options;
  for(let attempt=0;attempt<200;attempt++){
    const tree=await send('browsingContext.getTree',{});
    options=tree.contexts.find(item=>item.url.startsWith('moz-extension://'+extensionUuid+'/options.html'));
    if(options)break;
    if(attempt===199)throw Error('Addon options page unavailable: '+JSON.stringify(tree));
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const evaluate=async(expression)=>{
    const result=await send('script.evaluate',{expression,target:{context:options.context},awaitPromise:true,resultOwnership:'none'});
    if(result.type==='exception')throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  await evaluate(`browser.storage.local.set({settings:{automatic:false,directCapture:true,extensions:[],excluded:[],bypassUntil:0,locale:'en',overlay:false}})`);
  await evaluate(`browser.runtime.sendMessage({type:'settings_changed'})`);
  const added=JSON.parse(execFileSync(cli,['--json','add',base+'/nav-adapters/g4u/post','--navigate','--paused','--filename','original-post.bin'],{env,windowsHide:true,encoding:'utf8'}));
  const jobId=(added.job??added).id;
  assert.ok(jobId,JSON.stringify(added));
  await evaluate(`browser.runtime.sendMessage({type:'navigation_queue_continue',id:${JSON.stringify(jobId)}})`);
  const deadline=Date.now()+Number(process.env.NAV_DEADLINE_MS??90000);
  let job;
  while(Date.now()<deadline){
    const listed=JSON.parse(execFileSync(cli,['--json','list'],{env,windowsHide:true,encoding:'utf8'}));
    job=(listed.jobs??listed).find(item=>item.id===jobId);
    if(job?.state==='complete')break;
    if(['failed','cancelled'].includes(job?.state))throw Error(JSON.stringify({job,requests}));
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if (job?.state !== 'complete') {
    const observation = await evaluate(`(async()=>{
      const tabs=await browser.tabs.query({});
      const local=await browser.storage.local.get();
      const transient=browser.storage.session?await browser.storage.session.get():{};
      const records=Object.entries({...local,...transient}).filter(([key])=>key.startsWith('resolver-')).map(([key,value])=>({key,tabId:value.tabId,scope:value.scope,sourceGeneration:value.sourceGeneration,documentGeneration:value.documentGeneration,sessionEpoch:value.sessionEpoch}));
      const pages=await Promise.all(tabs.filter(tab=>tab.url?.startsWith(${JSON.stringify(base)})).map(async tab=>({id:tab.id,status:tab.status,incognito:tab.incognito,cookieStoreId:tab.cookieStoreId,marker:await browser.tabs.executeScript(tab.id,{frameId:0,code:'({nonce:globalThis.__downloaderDocumentNonce??null,resolver:!!globalThis.__downloaderResolver,errors:globalThis.__fixtureErrors})'}).catch(error=>({error:String(error)}))})));
      return JSON.stringify({sessionStorageAvailable:!!browser.storage.session,records,pages,cookieStores:await browser.cookies.getAllCookieStores(),filterEvents:browser.extension.getBackgroundPage()?.__fixtureFilterEvents,errors:browser.extension.getBackgroundPage()?.__fixtureErrors});
    })()`);
    await writeFile(resolve(dir,'observation.json'),observation);
  }
  assert.equal(job?.state,'complete',JSON.stringify({job,requests,extensionSnapshot:await evaluate(`browser.runtime.sendMessage({type:'snapshot'}).then(JSON.stringify)`)}));
  assert.deepEqual(requests,[{method:'POST',body:'token=fixture-token'}]);
  const bytes=await readFile(resolve(dir,'downloads','original-post.bin'));
  assert.equal(bytes.length,payload.length);assert.equal(digest(bytes),digest(payload));
  const evidence={browser:'Firefox/'+session.capabilities.browserVersion,os:process.platform,architecture:process.arch,
    version:JSON.parse(await readFile('package.json','utf8')).version,extensionAPI:'browser.webRequest.filterResponseData',
    transport:'persistent browser.runtime.connectNative',driver:'WebDriver BiDi for addon installation and controls; no byte relay',
    diagnosticSourceChanges:process.env.NAV_TRACE==='1',productionBackground:true,productionResolver:true,
    submissions:requests.length,bytes:bytes.length,sha256:digest(bytes),nativeVerifiedSha256:job.verified_sha256,state:job.state,
    limitations:['Local fixtures; live hosts/accounts pending','Firefox stable only; ESR and other OS rows are separate','Fixture permissions granted in isolated manifest; user permission prompts unqualified','POST first; blob/cancel/private/container qualification separate']};
  await writeFile(resolve(dir,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
  await send('session.end',{});
} catch (error) {
  await writeFile(resolve(dir, 'failure.json'), JSON.stringify({ stage: fixtureStage, error: String(error), requests }, null, 2));
  throw error;
} finally {
  for(const waiter of pending.values())waiter.reject(Error('Firefox fixture finished'));pending.clear();
  ws?.close();
  // This PID belongs to the Firefox process launched above with this fixture profile.
  // Windows needs tree termination to avoid leaving disposable content processes behind.
  if (browserProc?.pid && process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(browserProc.pid), '/T', '/F'], {windowsHide:true,stdio:'ignore'}); } catch {}
  }
  browserProc?.kill();browserProc?.stderr.destroy();browserProc?.unref();
  daemon.kill();daemon.stderr.destroy();daemon.unref();server.closeAllConnections();server.close();
  execFileSync('reg',['DELETE',registry,'/f'],{windowsHide:true,stdio:'ignore'});
}
