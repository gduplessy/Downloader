import { fixtures } from './network-fixtures.mjs';
import { spawn } from 'node:child_process';
import { mkdir,writeFile,readFile,stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'.local/network-qualification-'+Date.now());await mkdir(root,{recursive:true});
const binary=path.resolve(process.env.QUALIFY_BINARY??'.local/engine-target/release/examples/qualify'+(process.platform==='win32'?'.exe':''));
const server=await fixtures(path.join(root,'certificates'));
const baseNetwork={proxy_mode:'direct',ca_file:server.certFile,retries:2};
const named=url=>url.replace('127.0.0.1','download-fixture.invalid');
const cases=[
  {name:'http',url:server.http+'/file'},
  {name:'https',url:server.https+'/file'},
  {name:'tls_untrusted',url:server.https+'/file',network:{ca_file:null,retries:0},expected_failure:'network_failure'},
  {name:'proxy_unavailable',url:server.http+'/file',proxy:'http://127.0.0.1:1',network:{retries:0,connect_timeout_seconds:1},expected_failure:'network_failure'},
  {name:'http2_tls',url:server.h2+'/file',network:{http_policy:'http2_tls'}},
  {name:'ftp',url:server.ftp,pause_at:1024*1024,speed_limit:3*1024*1024},
  {name:'ftp_explicit_tls',url:server.ftp,network:{ftp_tls:true}},
  {name:'ftps_implicit',url:server.ftps},
  {name:'http_proxy',url:server.http+'/file',proxy:server.proxy},
  {name:'http_connect',url:server.https+'/file',proxy:server.proxy},
  {name:'https_proxy',url:server.https+'/file',proxy:server.secureProxy},
  ...['socks4','socks5','socks5h'].map(s=>({name:s,url:server.http+'/file',proxy:`${s}://127.0.0.1:${server.socksPort}`})),
  {name:'basic',url:server.http+'/basic',mode:'auth_probe',network:{authentication:'basic'}},
  {name:'digest',url:server.http+'/digest',mode:'auth_probe',network:{authentication:'digest'}},
  {name:'compressed',url:server.http+'/compressed'},
  {name:'zip64_offset',url:server.http+'/zip64',mode:'zip'},
  {name:'retry_after',url:server.http+'/retry'},
  {name:'pac',url:named(server.http)+'/file',require_proxy:true,network:{proxy_mode:'pac',pac_url:server.http+'/proxy.pac'}},
  {name:'pac_failover',url:named(server.http)+'/file',require_proxy:true,network:{proxy_mode:'pac',pac_url:server.http+'/failover.pac',retries:0,connect_timeout_seconds:1}},
  {name:'pac_explicit_direct',url:named(server.http)+'/file',network:{proxy_mode:'pac',pac_url:server.http+'/direct.pac',retries:0,connect_timeout_seconds:1}},
  {name:'pac_all_unavailable',url:named(server.http)+'/file',network:{proxy_mode:'pac',pac_url:server.http+'/unavailable.pac',retries:0,connect_timeout_seconds:1},expected_failure:'network_failure'},
  {name:'pac_tls_no_bypass',url:named(server.https)+'/file',network:{proxy_mode:'pac',pac_url:server.http+'/tls-failure.pac',ca_file:null,retries:0},expected_failure:'network_failure'},
  {name:'pac_auth_no_bypass',url:named(server.https)+'/file',network:{proxy_mode:'pac',pac_url:server.http+'/auth-failure.pac',retries:0},expected_failure:'authentication_required'},
  ...(process.platform==='win32'?[{name:'pac_loopback_bypass_rejected',url:server.http+'/file',network:{proxy_mode:'pac',pac_url:server.http+'/unavailable.pac',retries:0},expected_failure:'protocol_unsupported'}]:[]),
];
if(process.argv.includes('--benchmark'))for(const [delay,cap] of [[0,0],[2,0],[2,2]])for(const connections of [1,4])for(let repeat=1;repeat<=3;repeat++)cases.push({name:`benchmark_${delay}ms_cap${cap}_${connections}connections_run${repeat}`,url:server.http+`/file?delay=${delay}&chunk=65536&cap=${cap}`,connections});
if(process.argv.includes('--large'))cases.push({name:'large_over_4gib',url:server.http+'/large',sha256:server.largeSha256,connections:1,network:{checkpoint_milliseconds:100},pause_at:4*1024**3+123});
const results=[];
const skipped=[];
function run(binary,args,timeout=900000){return new Promise(resolve=>{let out='',err='';const p=spawn(binary,args,{windowsHide:true});const timer=setTimeout(()=>p.kill(),timeout);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.once('error',e=>{clearTimeout(timer);resolve({error:String(e)});});p.once('close',code=>{clearTimeout(timer);resolve(code===0?JSON.parse(out):{error:err,code});});});}
try {
  const onlyIndex=process.argv.indexOf('--only');
  const idmOnly=process.argv.includes('--idm-only');
  if(idmOnly && (!process.argv.includes('--idm') || onlyIndex>=0))throw Error('--idm-only requires --idm and cannot be combined with --only');
  const selected=onlyIndex<0?null:process.argv[onlyIndex+1]?.split(',');
  if(onlyIndex>=0 && (!selected?.length || selected.some(name=>!cases.some(c=>c.name===name))))throw Error('Unknown or missing --only fixture name');
  const active=(idmOnly?[]:cases.filter(c=>!selected || selected.includes(c.name))).filter(c=>{
    if(c.name==='pac_explicit_direct' && process.env.CI!=='true' && !selected){skipped.push({name:c.name,reason:'Requires the reserved hostname provisioned only on disposable CI runners'});return false;}
    return true;
  });
  for(const fixture of active){
    const directory=path.join(root,fixture.name);await mkdir(directory,{recursive:true});const config={...fixture,directory,sha256:fixture.sha256??server.sha256,network:{...baseNetwork,...fixture.network,...(fixture.proxy?{proxy_mode:'manual'}:{})}};
    const file=path.join(directory,'case.json');await writeFile(file,JSON.stringify(config));const before=server.stats.proxy;const result=await run(binary,[file]);if(fixture.require_proxy && !result.error && server.stats.proxy===before)result.error='PAC fixture did not actually traverse the proxy';results.push({name:fixture.name,...result});process.stdout.write(JSON.stringify(results.at(-1))+'\n');await writeFile(path.join(root,'results.json'),JSON.stringify({platform:process.platform,results,skipped,observations:server.stats},null,2));
  }
  const idmArg=process.argv.indexOf('--idm');
  if(idmArg>=0){
    const executable=process.argv[idmArg+1];if(!executable)throw Error('--idm requires an executable path');const directory=path.join(root,'idm');await mkdir(directory,{recursive:true});
    const url=server.http+'/file?delay=2&chunk=65536';const destination=path.join(directory,'idm-fixture.bin');const started=performance.now();
    const p=spawn(executable,['/d',url,'/p',directory,'/f','idm-fixture.bin','/n'],{windowsHide:true,stdio:'ignore'});let launchError;p.on('error',e=>launchError=String(e));
    let result={name:'idm',error:'No completed fixture output within 180 seconds; check IDM dialogs/license status'};
    while(performance.now()-started<180000){try{if((await stat(destination)).size===server.size){const sha=createHash('sha256').update(await readFile(destination)).digest('hex');result={name:'idm',seconds:(performance.now()-started)/1000,bytes:server.size,sha256:sha,hash_matches:sha===server.sha256};break;}}catch{}await new Promise(r=>setTimeout(r,250));}
    if(launchError)result.error=launchError;results.push(result);process.stdout.write(JSON.stringify(result)+'\n');
  }
}finally{await writeFile(path.join(root,'results.json'),JSON.stringify({platform:process.platform,results,skipped,observations:server.stats},null,2));await server.close();}
if(results.some(r=>r.error))process.exitCode=1;
