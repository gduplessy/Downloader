import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const execute=promisify(execFile);
const browser=process.env.BROWSE_CLI ?? 'C:/Users/gduplessy/.agents/skills/gstack/browse/dist/browse.exe';
const env={...process.env,BROWSE_STATE_FILE:resolve('.gstack/nav-scheduler/browse.json'),BROWSE_PARENT_PID:'0',BROWSE_START_TIMEOUT:'60000'};
const run=async(...args)=>(await execute(browser,args,{env,windowsHide:true,timeout:90000,maxBuffer:1000000})).stdout.trim();
const js=async code=>JSON.parse(await run('js',code));
const request=async request=>js(`(async()=>JSON.stringify(await browser.runtime.sendMessage(${JSON.stringify({type:'navigation_scheduler',request})})))()`);
const url=(await readFile('.local/nav-scheduling/url.txt','utf8')).trim();
for(const match of (await run('tabs')).matchAll(/\[(\d+)\]/g)){if(Number(match[1])!==1)await run('closetab',match[1]);}
await run('tab','1');
await run('goto',url);
await run('console','--clear');
await request({action:'settings',max_active:3,notifications:false});await request({action:'control',id:null,paused:false,priority:null});
const initial=await request({action:'snapshot'});assert.equal(initial.tasks.length,50);
const tabs=[];
const admissions=[];
const evidence={fixture:'scheduler-real-engine-browser-ui',transport:'Fixture browser API shim to isolated real Rust Engine; not installed-extension/native-messaging qualification',user_agent:await run('js','navigator.userAgent'),rows:50,resources:[],assertions:[]};
const resources=async()=>JSON.parse((await execute('powershell.exe',['-NoProfile','-File','scripts/nav-fixtures/scheduler/resources.ps1'],{env,windowsHide:true,timeout:30000})).stdout);
for(let i=0;i<20;i++){
 if(i===3){evidence.resources.push({active:3,...await resources()});await request({action:'settings',max_active:20,notifications:false});}
 const opened=await run('newtab',url+'?resource='+i);const tab=Number(opened.match(/Opened tab (\d+)/)?.[1]);assert.ok(Number.isInteger(tab));tabs.push(tab);
 const id=initial.tasks[i].id;const admitted=await request({action:'admit',id,generation:1});assert.equal(admitted.tasks.find(t=>t.id===id).status,'active');
 await request({action:'heartbeat',id,generation:1,tab_id:tab});admissions.push({id,generation:1,tab_id:tab});
}
const active=await request({action:'reconcile',live:admissions});assert.equal(active.active,20);assert.equal(active.tasks.filter(t=>t.status==='active').length,20);
evidence.resources.push({active:20,...await resources()});evidence.assertions.push('3 then20 real renderer tabs admitted by real engine with matching live fixture tab IDs');
const lowered=await request({action:'settings',max_active:3,notifications:false});assert.equal(lowered.active,20);assert.equal(lowered.settings.max_active,3);
evidence.assertions.push('Lowering20 to3 retained20 existing leases and tabs');
const blocked=await request({action:'admit',id:initial.tasks[20].id,generation:1});assert.equal(blocked.tasks.find(t=>t.id===initial.tasks[20].id).lease,null);
evidence.assertions.push('Twenty-first task denied without closing existing tabs');
for(let i=0;i<tabs.length;i++){await request({action:'release',id:initial.tasks[i].id,generation:1});await run('closetab',String(tabs[i]));}
await run('tab','1');await run('goto',url);
await run('fill','#navigation-limit','20');await run('click','#queue > button:nth-of-type(1)');const configured=await js('JSON.stringify(fixtureSnapshot.settings)');assert.equal(configured.max_active,20);
await run('click','#queue > button:nth-of-type(2)');const paused=await js('JSON.stringify(fixtureSnapshot.settings)');assert.equal(paused.paused,true);
await run('screenshot','--viewport','docs/evidence/nav-scheduling/queue-ui.png');evidence.assertions.push('Visible settings saved20, pause/resume control paused admission, screenshot captured');
const errors=await run('console','--errors');assert.equal(errors,'(no console errors)');
await writeFile('docs/evidence/nav-scheduling/browser-fixture.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
