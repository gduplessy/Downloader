// Exercise the shipped CLI and background service over restricted per-user IPC.
import { fixtures } from './network-fixtures.mjs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const execute=promisify(execFile);
const root=path.resolve(process.argv[2]??'.local/control-qualification');await mkdir(root,{recursive:true});
const binary=path.resolve(process.env.CLI_BINARY??`${process.env.CARGO_TARGET_DIR??'target'}/debug/downloader${process.platform==='win32'?'.exe':''}`);
const env={...process.env,DOWNLOADER_DATA_DIR:path.join(root,'state')};
const cli=async(...args)=>JSON.parse((await execute(binary,['--json',...args],{env,windowsHide:true,timeout:20000,maxBuffer:8*1024*1024})).stdout);
const server=await fixtures(path.join(root,'certificates'));let watcher;
const frames=[];let pending='',watchError='';
async function wait(predicate){const start=Date.now();while(!await predicate()){if(Date.now()-start>60000)throw Error('Control fixture timed out '+watchError);await new Promise(r=>setTimeout(r,100));}}
try{
  const initial=await cli('list');const settings={...initial.settings,max_jobs:1,connections:1,speed_limit:2*1024*1024,network:{...initial.settings.network,proxy_mode:'direct'}};
  const settingsFile=path.join(root,'settings.json');await writeFile(settingsFile,JSON.stringify(settings));await cli('set',settingsFile);
  watcher=spawn(binary,['--json','watch'],{env,windowsHide:true});watcher.stderr.on('data',d=>watchError+=d);
  watcher.stdout.on('data',d=>{pending+=d;while(pending.includes('\n')){const end=pending.indexOf('\n'),line=pending.slice(0,end);pending=pending.slice(end+1);if(line.trim())frames.push(JSON.parse(line));}});
  await wait(()=>frames[0]?.snapshot);assert.equal(frames[0].snapshot.version,1);
  const job=await cli('add',server.http+'/file?delay=2&chunk=65536','--directory',root,'--filename','control.bin','--sha256',server.sha256);
  await wait(async()=> (await cli('list')).jobs.some(j=>j.id===job.id && j.bytes>1024*1024));
  await cli('pause',job.id);await wait(async()=> (await cli('list')).jobs.some(j=>j.id===job.id && j.state==='paused'));
  await cli('resume',job.id);await wait(async()=> (await cli('list')).jobs.some(j=>j.id===job.id && j.state==='complete'));
  await wait(()=>frames.flatMap(f=>f.events).some(e=>e.job?.id===job.id && e.job.state==='complete'));
  const hash=createHash('sha256').update(await readFile(path.join(root,'control.bin'))).digest('hex');assert.equal(hash,server.sha256);
  const events=frames.flatMap(f=>f.events);for(let i=1;i<events.length;i++)assert.ok(events[i].sequence>events[i-1].sequence);
  watcher.kill();watcher=null;
  const before=(await cli('list')).sequence;await cli('quit');await new Promise(r=>setTimeout(r,500));
  const restarted=await cli('list');assert.ok(restarted.sequence>=before);assert.equal(restarted.jobs.find(j=>j.id===job.id).state,'complete');
  const result={version:1,snapshot_first:true,sequenced_events:events.length,pause_resume:true,restart_complete:true,sha256:hash};
  await writeFile(path.join(root,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{watcher?.kill();try{await cli('quit');}catch{}await server.close();}
