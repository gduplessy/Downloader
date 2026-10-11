// Only disposable CI runners receive a test-only DNS entry. Never modify a developer host.
import { appendFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
if(process.env.CI!=='true')throw Error('Fixture host registration is restricted to disposable CI runners');
const file=process.platform==='win32'?path.join(process.env.WINDIR,'System32','drivers','etc','hosts'):'/etc/hosts';
const contents=await readFile(file,'utf8');
if(contents.includes('download-fixture.invalid'))throw Error('Refusing to reuse an existing fixture hostname');
const entry='\n127.0.0.1 download-fixture.invalid\n';
if(process.platform==='win32')await appendFile(file,entry);
else await new Promise((resolve,reject)=>{const child=spawn('sudo',['tee','-a',file],{stdio:['pipe','ignore','pipe']});let error='';child.stderr.on('data',d=>error+=d);child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(error)));child.stdin.end(entry);});
console.log('Registered the isolated loopback fixture hostname on this disposable runner');
