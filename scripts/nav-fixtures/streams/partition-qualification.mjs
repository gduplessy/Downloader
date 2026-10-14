// Reuse the installed production Blob qualification driver, without modifying runtime source.
// Both jobs run in one isolated browser/profile/service. Bytes travel only through the page,
// production extension and native host; this driver reads published files for independent hashes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

assert.notEqual(
  process.env.NAV_TRACE,
  '1',
  'Partition acceptance requires unchanged runtime source',
);
const driverUrl = new URL('./qualification.mjs', import.meta.url);
const original = await readFile(driverUrl, 'utf8');
let source = original.replaceAll('\r\n', '\n');
function replaceExact(before, after) {
  assert.equal(
    source.split(before).length,
    2,
    'Qualification driver changed: ' + before.slice(0, 70),
  );
  source = source.replace(before, after);
}
replaceExact(
  "from './private-context.mjs'",
  `from ${JSON.stringify(new URL('./private-context.mjs', import.meta.url).href)}`,
);
replaceExact(
  "createRequire(new URL('../../../apps/extension/package.json', import.meta.url))",
  `createRequire(${JSON.stringify(pathToFileURL(resolve('apps/extension/package.json')).href)})`,
);
source = source.replaceAll('new URL(import.meta.url)', JSON.stringify(fileURLToPath(driverUrl)));
source = source.replaceAll(
  "new URL('./private-context.mjs', import.meta.url)",
  JSON.stringify(fileURLToPath(new URL('./private-context.mjs', import.meta.url))),
);
replaceExact(
  "host_permissions: ['http://127.0.0.1/*']",
  "host_permissions: ['http://127.0.0.1/*','http://*.localhost/*','https://*.localhost/*']",
);
replaceExact(
  "      'cookies',",
  "      ...(process.env.NAV_PARTITION_NO_COOKIES==='1'?[]:['cookies']),\n      'webNavigation',",
);
replaceExact(
  "      '--headless=new',",
  "      '--headless=new',\n      '--host-resolver-rules=MAP *.localhost 127.0.0.1',",
);
replaceExact(
  'await build({',
  "const productionBuild=await build({\n  absWorkingDir:resolve('.'),metafile:true,",
);
replaceExact(
  '});\nif (privateMode) {',
  "});\nawait writeFile(resolve(dir,'production-build-metafile.json'),JSON.stringify(productionBuild.metafile,null,2));\nif (privateMode) {",
);
const serverStart = source.indexOf('const server = createServer(');
const serverEnd = source.indexOf(
  "await new Promise((r) => server.listen(0, '127.0.0.1', r));",
  serverStart,
);
assert.ok(serverStart > 0 && serverEnd > serverStart);
source =
  source.slice(0, serverStart) +
  String.raw`
const server = createServer(async (req,res)=>{
  const hostname=(req.headers.host??'').split(':')[0];
  const port=server.address().port;
  const embed='http://embed.localhost:'+port;
  const path=req.url.split('?')[0];
  originRequests.push({method:req.method,path,host:hostname,browser:/Chrome|Edg/.test(req.headers['user-agent']??'')});
  if(path==='/embedded' && hostname==='embed.localhost'){
    const first=(req.headers.referer??'').startsWith('http://a.localhost:');
    res.setHeader('Set-Cookie','fixture_auth='+(first?'first':'second')+'; Secure; SameSite=None; Partitioned; Path=/');
    res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>Shared embedded fixture</title>Ready');
  }else if(path==='/payload' && hostname==='embed.localhost'){
    const origin=req.headers.origin;
    if(!/^http:\/\/[ab]\.localhost:\d+$/.test(origin??'')){res.writeHead(403);res.end();return;}
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Credentials','true');
    const first=(req.headers.cookie??'').includes('fixture_auth=first');
    const second=(req.headers.cookie??'').includes('fixture_auth=second');
    requests.push({method:req.method,topSite:new URL(origin).hostname,authorized:first!==second});
    if(req.method!=='GET'||first===second){res.writeHead(401);res.end();return;}
    const bytes=Buffer.alloc(Number(process.env.NAV_BYTES??262161));
    for(let i=0;i<bytes.length;i++)bytes[i]=(i*31+(first?7:113))%251;
    res.setHeader('Content-Type','application/octet-stream');res.end(bytes);
  }else if(path==='/nav-adapters/g4u/blob' && ['a.localhost','b.localhost'].includes(hostname)){
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><title>Partitioned page-owned Blob</title><iframe src="'+embed+'/embedded"></iframe><a data-nav-fixture-control download="original-雪.bin">Download original file</a><script>window.originalClicks=0;document.querySelector("a").addEventListener("click",()=>window.originalClicks++);document.querySelector("iframe").addEventListener("load",async()=>{const response=await fetch("'+embed+'/payload",{credentials:"include"});if(!response.ok){document.title="Partition cookie unavailable";return;}const original=URL.createObjectURL(await response.blob());window.fixtureBlob=original;document.querySelector("a").href=original;document.querySelector("a").style.display="block";});</script>');
  }else{res.writeHead(404);res.end();}
});
` +
  source.slice(serverEnd);
replaceExact(
  '  const regularEvaluate = evaluate;',
  String.raw`
  const partitionRows=[];
  const buildInputs={};
  for(const input of Object.keys(productionBuild.metafile.inputs)){buildInputs[input]=digest(await readFile(resolve(input)));}
  observations.productionBuild={absWorkingDir:resolve('.'),inputSha256:buildInputs,backgroundSha256:digest(await readFile(resolve(ext,'background.js'))),resolverSha256:digest(await readFile(resolve(ext,'resolver.js')))};
  const fixtureBase=base;
  if(await evaluate('typeof chrome.cookies?.getPartitionKey')!=='function'){
    const listed=JSON.parse(execFileSync(cli,['--json','list'],{env,windowsHide:true,encoding:'utf8',timeout:8000}));
    const jobsStarted=(listed.jobs??listed).length;assert.equal(jobsStarted,0);
    const cookiePermission=await evaluate('chrome.permissions.contains({permissions:[\"cookies\"]})');assert.equal(cookiePermission,false);
    await writeFile(resolve(dir,'partition-evidence.json'),JSON.stringify({acceptance:'blocked',reason:'partition_scope_api_unavailable',browser:version.product,sourceRevision,jobsStarted,cookiePermission,originRequests,build:observations.productionBuild,native:observations.nativeExecutables,partitionDriverSha256:process.env.NAV_PARTITION_DRIVER_SHA256,generatedDriverSha256:process.env.NAV_PARTITION_GENERATED_SHA256},null,2));
    throw Error('Partition scope API unavailable; direct capture denied before job creation');
  }
  for(const site of ['a','b']){
  const base=fixtureBase.replace('127.0.0.1',site+'.localhost');
  const filename='partition-'+site+'.bin';
  const payload=Buffer.alloc(Number(process.env.NAV_BYTES??262161));
  for(let i=0;i<payload.length;i++)payload[i]=(i*31+(site==='a'?7:113))%251;
  const regularEvaluate = evaluate;`,
);
replaceExact(
  '  const deadlinePreview = Date.now() + 60000;',
  String.raw`
  const partitionProof=await evaluate('(async()=>{const tabId='+ownedTab.id+';const frames=await chrome.webNavigation.getAllFrames({tabId});const rows=[];for(const frame of frames){rows.push({frameId:frame.frameId,url:frame.url,documentId:frame.documentId,partition:await chrome.cookies.getPartitionKey({tabId,frameId:frame.frameId})});}return rows;})()');
  const topProof=partitionProof.find(row=>row.frameId===0);
  const embeddedProof=partitionProof.find(row=>row.url.includes('/embedded'));
  assert.ok(topProof?.partition?.partitionKey?.topLevelSite,'Actual top-frame partition unavailable');
  assert.ok(embeddedProof?.partition?.partitionKey?.topLevelSite,'Actual embedded partition unavailable');
  assert.notEqual(embeddedProof.frameId,0);
  assert.equal(embeddedProof.partition.partitionKey.topLevelSite,topProof.partition.partitionKey.topLevelSite);
  assert.equal(embeddedProof.partition.partitionKey.hasCrossSiteAncestor,true);
  const deadlinePreview = Date.now() + 60000;`,
);
replaceExact(
  "  assert.deepEqual(requests, [], 'Blob path must not issue POST/HEAD/GET to response URL');",
  String.raw`
  const ownRequests=requests.filter(row=>row.topSite===site+'.localhost');
  assert.equal(ownRequests.length,1,'Exactly one original page-owned fetch per partition');
  assert.equal(ownRequests[0].method,'GET'); assert.equal(ownRequests[0].authorized,true);
  assert.equal(job.navigation_scope.partition_key.top_level_site,topProof.partition.partitionKey.topLevelSite,'Native scope must retain actual frame0 partition');
  assert.equal(observations.nativeOriginRequests,0,'No native anonymous origin request');`,
);
replaceExact(
  "  await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));",
  `  evidence.originalPartitionRequests=ownRequests;
  evidence.partitionProof=partitionProof;
  evidence.sourceScope=job.navigation_scope;
  partitionRows.push(evidence);
  await writeFile(resolve(dir, 'partition-'+site+'-evidence.json'), JSON.stringify(evidence, null, 2));`,
);
replaceExact(
  '} catch (error) {\n  let latest;',
  String.raw`
  await command('Target.detachFromTarget',{sessionId:ownedSession}).catch(()=>{});
  }
  assert.equal(partitionRows.length,2);
  assert.notEqual(partitionRows[0].sha256,partitionRows[1].sha256);
  assert.notEqual(partitionRows[0].sourceScope.partition_key.top_level_site,partitionRows[1].sourceScope.partition_key.top_level_site);
  assert.equal(partitionRows[0].sourceScope.profile,partitionRows[1].sourceScope.profile);
  assert.equal(partitionRows[0].sourceScope.cookie_store_id,partitionRows[1].sourceScope.cookie_store_id);
  const cookieIsolation=[];
  for(const row of partitionRows){
    const topLevelSite=row.sourceScope.partition_key.top_level_site;
    const correct=topLevelSite.includes('a.localhost')?'first':'second';
    const cookieCheck=await evaluate('(async()=>{const cookies=await chrome.cookies.getAll({name:"fixture_auth",partitionKey:{topLevelSite:'+JSON.stringify(topLevelSite)+',hasCrossSiteAncestor:true}});return {count:cookies.length,correct:cookies.some(c=>c.domain==="embed.localhost"&&c.value==='+JSON.stringify(correct)+'),partitions:cookies.map(c=>c.partitionKey)};})()');
    if(cookieCheck.count!==1){console.log(JSON.stringify({cookieVisibility:await evaluate('(async()=>{const cookies=await chrome.cookies.getAll({partitionKey:{}});return cookies.map(c=>({name:c.name,domain:c.domain,secure:c.secure,partitionKey:c.partitionKey}));})()')}));}
    assert.equal(cookieCheck.count,1);assert.equal(cookieCheck.correct,true);
    cookieIsolation.push({topLevelSite,name:'fixture_auth',...cookieCheck});
  }
  const nativeAfter={hostAndDaemon:await executableIdentity(nativeBinary,'target/debug/downloader-service.exe'),cli:await executableIdentity(cli,'target/debug/downloader.exe')};
  assert.equal(nativeAfter.hostAndDaemon.sha256,observations.nativeExecutables.hostAndDaemon.sha256);
  assert.equal(nativeAfter.cli.sha256,observations.nativeExecutables.cli.sha256);
  await writeFile(resolve(dir,'partition-evidence.json'),JSON.stringify({partitionDriverSha256:process.env.NAV_PARTITION_DRIVER_SHA256,generatedDriverSha256:process.env.NAV_PARTITION_GENERATED_SHA256,cookieIsolation,nativeAfter,acceptance:'passed',sourceRevision,browser:version.product,productionScope:true,sameBrowserProfile:true,rows:partitionRows,embeddedFrameCapture:'unsupported: production resolver owns frame0 only',missingApi:'guard denies before any job; API present in this installed run'},null,2));
} catch (error) {
  let latest;`,
);
replaceExact(
  '\'(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(t=>t.url?.includes("/nav-adapters/g4u/blob"));})()\'',
  "'(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(t=>t.url?.startsWith('+JSON.stringify(base+'/nav-adapters/g4u/blob')+'));})()'",
);
const generated = resolve('.fixture-streams', 'partition-driver-' + Date.now() + '.mjs');
await mkdir(resolve('.fixture-streams'), { recursive: true });
await writeFile(generated, source);
const child = spawn(process.execPath, [generated], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    NAV_PARTITION_DRIVER_SHA256: createHash('sha256')
      .update(await readFile(new URL(import.meta.url)))
      .digest('hex'),
    NAV_PARTITION_GENERATED_SHA256: createHash('sha256').update(source).digest('hex'),
    NAV_CASE: 'blob',
    NAV_PRIVATE: '0',
    NAV_BYTES: process.env.NAV_BYTES ?? '262161',
  },
});
child.on('error', (error) => {
  throw error;
});
const exitCode = await new Promise((resolveExit) => child.on('exit', resolveExit));
process.exitCode = exitCode ?? 1;
