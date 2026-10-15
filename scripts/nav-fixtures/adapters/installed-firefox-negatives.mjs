// Installed production Firefox adapter negatives. Browser/native state is isolated per case.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { startAdapterFixtureServer } from './server.mjs';
const require=createRequire(new URL('../../../apps/extension/package.json',import.meta.url));
const {build}=require('esbuild');
const scenario=process.env.NAV_ADAPTER_CASE??'disabled';
assert(['disabled','changed'].includes(scenario));
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const executable=process.env.NAV_BROWSER??'C:/Program Files/Mozilla Firefox/firefox.exe';
const dir=resolve('.fixture-adapters','firefox-'+scenario+'-'+randomUUID()),ext=resolve(dir,'extension'),data=resolve(dir,'service');
await mkdir(ext,{recursive:true});await mkdir(data,{recursive:true});
assert(process.env.NAV_NATIVE_BINARY&&process.env.NAV_CLI_BINARY&&process.env.NAV_NATIVE_REVISION,'Specify matching immutable native pair and exact build revision');
const nativeBinary=resolve(dir,'downloader-service.exe'),cli=resolve(dir,'downloader.exe');
await copyFile(process.env.NAV_NATIVE_BINARY,nativeBinary);await copyFile(process.env.NAV_CLI_BINARY,cli);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const nativeBuildRevision=process.env.NAV_NATIVE_REVISION;
const initialNativeHash=digest(await readFile(nativeBinary)),initialCliHash=digest(await readFile(cli));
const extId='downloader-adapter-'+randomUUID()+'@local',extensionUuid=randomUUID(),host='org.downloader.fixture_'+randomUUID().replaceAll('-','');
const nativeManifest=resolve(dir,'native.json');
await writeFile(nativeManifest,JSON.stringify({name:host,description:'Isolated production adapter negatives',path:nativeBinary,type:'stdio',allowed_extensions:[extId]}));
await writeFile(resolve(data,'native-allowlist.json'),JSON.stringify({chrome_ids:[],firefox_ids:[extId]}));
await build({entryPoints:['apps/extension/src/background.ts','apps/extension/src/resolver.ts','apps/extension/src/options.ts'],outdir:ext,bundle:true,format:'iife',target:'es2022',define:{BROWSER:JSON.stringify('firefox')},plugins:[{name:'fixture-native-address',setup(builder){builder.onLoad({filter:/background\.ts$/},async({path})=>({contents:(await readFile(path,'utf8')).replaceAll('org.downloader.native',host),loader:'ts'}));}}]});
await copyFile('apps/extension/public/options.html',resolve(ext,'options.html'));
await writeFile(resolve(ext,'manifest.json'),JSON.stringify({manifest_version:2,name:'Downloader production adapter negatives',version:'0.1.0',browser_specific_settings:{gecko:{id:extId,strict_min_version:'115.0'}},permissions:['nativeMessaging','cookies','tabs','storage','webRequest','webRequestBlocking','downloads','contextMenus','alarms','http://127.0.0.1/*'],background:{scripts:['background.js'],persistent:false},options_ui:{page:'options.html',open_in_tab:true}}));
await writeFile(resolve(dir,'empty.js'),'// No renderer harness: production resolver only.');
const fixture=await startAdapterFixtureServer({port:0,harness:resolve(dir,'empty.js')});
const server=fixture.server,base=fixture.base,requests=fixture.requests;
const pagePath='/nav-adapters/g4u/ambiguous?case='+scenario;
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
  const at=async(context,expression)=>{
    const result=await send('script.evaluate',{expression,target:{context},awaitPromise:true,resultOwnership:'none'});
    if(result.type==='exception')throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const call=(...args)=>JSON.parse(execFileSync(cli,['--json',...args],{env,encoding:'utf8',windowsHide:true,timeout:60000}));
  const added=call('add',base+pagePath,'--navigate','--filename',scenario+'.bin');
  const jobId=(added.job??added).id;assert(jobId);
  await evaluate('browser.runtime.sendMessage('+JSON.stringify({type:'continue_navigation',url:base+pagePath})+')');
  let pageContext;
  for(let i=0;i<200;i++){
    pageContext=(await send('browsingContext.getTree',{})).contexts.find(c=>c.url===base+pagePath);
    if(pageContext&&await at(pageContext.context,'!!document.getElementById("__downloader_adapter_preview")'))break;
    if(i===199)throw Error('Actual owned adapter preview unavailable');
    await new Promise(r=>setTimeout(r,100));
  }
  await send('browsingContext.activate',{context:pageContext.context});
  assert.equal(await at(pageContext.context,'document.activeElement?.id'),'__downloader_adapter_preview','Production panel must own initial keyboard focus');
  const keys=async(values)=>send('input.performActions',{context:pageContext.context,actions:[{type:'key',id:'adapter-preview-keyboard',actions:values.flatMap(value=>[{type:'keyDown',value},{type:'keyUp',value}])}]});
  const inspectUi=async()=>{
    const code='(()=>{const host=document.getElementById("__downloader_adapter_preview");if(!host)return {present:false};const root=host.openOrClosedShadowRoot??browser.dom?.openOrClosedShadowRoot?.(host);if(!root)return {present:true,inspectionUnavailable:true};return {present:true,status:root.querySelector("[role=status]")?.textContent,radios:[...root.querySelectorAll("input[type=radio]")].map(n=>({checked:n.checked,disabled:n.disabled})),buttons:[...root.querySelectorAll("button")].map(n=>({text:n.textContent,disabled:n.disabled}))};})()';
    return JSON.parse(await evaluate('(async()=>{const tabs=await browser.tabs.query({});const tab=tabs.find(t=>t.url==='+JSON.stringify(base+pagePath)+');if(!tab)throw Error("Owned page unavailable");return JSON.stringify((await browser.tabs.executeScript(tab.id,{frameId:0,code:'+JSON.stringify(code)+'}))[0]);})()'));
  };
  // Use actual browser input against the production closed-shadow preview; no JS click or selection shim.
  if(scenario==='disabled'){
    await keys([' ','\uE004','\uE004','\uE004','\uE004','\uE007']);
    let stored;
    for(let i=0;i<100;i++){
      stored=JSON.parse(await evaluate('browser.storage.local.get("settings").then(JSON.stringify)'));
      if(stored.settings.disabledAdapters?.includes('local-fixture'))break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert(stored.settings.disabledAdapters?.includes('local-fixture'),'Actual generic-controls input did not persist disabled adapter');
    // Keep observing real UI until asynchronous owned refresh produces generic controls.
    for(let i=0;i<100;i++) {
      const ui=await inspectUi();
      if(!ui.inspectionUnavailable&&ui.radios?.length===2&&!ui.buttons.some(b=>b.text==='Use generic controls'))break;
      if(i===99)throw Error('Generic preview not observed '+JSON.stringify(ui));
      await new Promise(r=>setTimeout(r,100));
    }
  } else {
    await keys([' ']);
    await at(pageContext.context,'document.querySelector("a[href]").setAttribute("href","/trap/purchase")');
    await keys(['\uE004','\uE007']);
    await new Promise(r=>setTimeout(r,500));
  }
  const actualUi=await inspectUi();
  if(scenario==='changed'&&!actualUi.inspectionUnavailable){assert.equal(actualUi.status,'Page changed. Refresh the selection.');assert(actualUi.buttons.find(b=>b.text==='Continue')?.disabled);}
  const shot=await send('browsingContext.captureScreenshot',{context:pageContext.context});
  await writeFile(resolve(dir,'preview.png'),Buffer.from(shot.data,'base64'));
  assert(await at(pageContext.context,'!!document.getElementById("__downloader_adapter_preview")'),'Production preview/recovery control disappeared');
  assert.equal(requests.length,0,'Adapter negative requested file or purchase trap');
  const current=call('list').jobs.find(j=>j.id===jobId);
  assert(current&&current.state!=='complete');assert.equal(current.bytes,0);
  assert.equal(digest(await readFile(nativeBinary)),initialNativeHash);assert.equal(digest(await readFile(cli)),initialCliHash);
  const sourceHashes={};for(const file of ['apps/extension/src/background.ts','apps/extension/src/resolver.ts','apps/extension/src/navigation/adapters/policy.ts','apps/extension/src/navigation/adapters/selection-ui.ts','apps/extension/src/navigation/adapters/preview.ts'])sourceHashes[file]=digest(await readFile(file));
  const bundleHashes={};for(const file of ['background.js','resolver.js','options.js'])bundleHashes[file]=digest(await readFile(resolve(ext,file)));
  const evidence={fixture:'production-installed-firefox-adapter-negatives-v1',checked_runtime_revision:sourceRevision,native_build_revision:nativeBuildRevision,native_version:call('diagnostics').version,native_binary_sha256:initialNativeHash,cli_binary_sha256:initialCliHash,sourceHashes,bundleHashes,driver:{path:'scripts/nav-fixtures/adapters/installed-firefox-negatives.mjs',sha256:digest(await readFile('scripts/nav-fixtures/adapters/installed-firefox-negatives.mjs'))},browser:session.capabilities.browserVersion,os:process.platform,arch:process.arch,scenario,actualUi,state:current.state,payload_requests:0,unauthorized_requests:0,published:false,screenshot:resolve(dir,'preview.png'),visible_status_observed:false,limits:['Actual BiDi keyboard input into production closed-shadow preview; screenshot requires separate inspection before final visual acceptance','CLI + trusted extension message starts navigation; desktop/native context-menu UI activation is not qualified','Synthetic loopback layout only; live hosts/accounts, private-addon, ESR and other OS rows remain pending','Unique native host and pregranted loopback fixture permissions; no context/authorization shim']};
  await mkdir('.local/nav-adapters',{recursive:true});
  await writeFile(resolve(dir,'evidence.json'),JSON.stringify(evidence,null,2));
  await writeFile('.local/nav-adapters/installed-negatives-firefox-'+scenario+'-result.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
  await send('session.end',{});
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
