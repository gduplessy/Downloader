import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {build} from '../../../apps/extension/node_modules/esbuild/lib/main.js';
const root=resolve('.local/nav-scheduling');await mkdir(root,{recursive:true});
const data=resolve(root,'fixture-'+randomUUID());await mkdir(data,{recursive:true});
const binary=resolve(process.env.CARGO_TARGET_DIR ?? 'target-nav-scheduling','debug/examples/navigation_scheduler_fixture.exe');
const fixtureBinary=resolve(data,'engine.exe');await copyFile(binary,fixtureBinary);
const replies=[];
const startEngine=()=>{const child=spawn(fixtureBinary,[data],{windowsHide:true,stdio:['pipe','pipe','inherit']});createInterface({input:child.stdout}).on('line',line=>{const next=replies.shift();if(next)next(JSON.parse(line));});return child;};
let processEngine=startEngine();
const call=command=>new Promise((resolveCall,reject)=>{replies.push(resolveCall);processEngine.stdin.write(JSON.stringify(command)+'\n',error=>error&&reject(error));});
const owner=randomUUID();
const shim='export default new Proxy({}, { get: (_, key) => globalThis.browser[key] });';
await build({entryPoints:['scripts/nav-fixtures/scheduler/ui.ts'],bundle:true,format:'iife',outfile:resolve(root,'ui.js'),plugins:[{name:'fixture-browser',setup(b){b.onResolve({filter:/^webextension-polyfill$/},()=>({path:'browser',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:shim,loader:'js'}));}}]});
const server=createServer(async(req,res)=>{
 try {
  if(req.method==='POST'&&req.url==='/command') {
   let body='';for await(const c of req)body+=c;if(body.length>1000000)throw Error('Frame too large');
   const message=JSON.parse(body);let result;
   if(message.type==='navigation_scheduler')result=await call({command:'navigation_scheduler',args:{owner,request:message.request}});
   else if(message.type==='navigation_queue_cancel'){await call({command:'cancel',args:{id:message.id}});result=await call({command:'navigation_scheduler',args:{owner,request:{action:'release',id:message.id,generation:1}}});}
   else if(message.type==='navigation_queue_continue')result=await call({command:'navigation_scheduler',args:{owner,request:{action:'control',id:message.id,paused:false,priority:null}}});
   else if(message.type==='fixture_same_host')result=await call({command:'navigate',args:{request_id:randomUUID(),url:'https://fixture0.invalid/same-session',paused:true,context:{profile:owner,headers:{},private:false},description:''}});
   else if(message.type==='fixture_restart'){const exited=new Promise(resolveExit=>processEngine.once('exit',resolveExit));processEngine.stdin.end();await exited;processEngine=startEngine();result=await call({command:'navigation_scheduler',args:{owner,request:{action:'snapshot'}}});}
   else throw Error('Unsupported fixture control');
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
  }
  if(req.url==='/ui.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(resolve(root,'ui.js')));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><title>Navigation scheduler fixture</title><style>body{font:16px system-ui;max-width:900px;margin:32px auto}button,input{font:inherit;margin:6px;padding:6px}li{border-bottom:1px solid #ddd;padding:8px}label{display:block}input[type=number]{width:90px}</style></head><body><main id="queue"></main><script src="/ui.js"></script></body></html>');
 }catch(e){res.statusCode=500;res.end(JSON.stringify({ok:false,error:String(e)}));}
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));const url=`http://127.0.0.1:${server.address().port}`;
for(let i=0;i<50;i++)await call({command:'navigate',args:{request_id:randomUUID(),url:`https://fixture${i}.invalid/page${i}`,filename:null,directory:null,queue:null,checksum:null,paused:true,context:{profile:owner,headers:{},private:false},media:null,description:''}});
await writeFile(resolve(root,'url.txt'),url);console.log(url);
function stop(){server.close();processEngine.stdin.end();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
