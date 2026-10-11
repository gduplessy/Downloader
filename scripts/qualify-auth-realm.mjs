// Owns only uniquely named Docker resources; never joins or reconfigures the host domain.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('.local', `auth-realm-${Date.now()}-${process.pid}`);
const name = `downloader-auth-${Date.now()}-${process.pid}`;
const image = 'downloader-auth-realm:local';
const secrets = path.join(root, 'secrets');
const password = `Dl!${randomBytes(24).toString('hex')}`;
const adminPassword = `Dl!${randomBytes(24).toString('hex')}`;
await mkdir(secrets, {recursive:true});
await writeFile(path.join(secrets,'admin-password'),adminPassword,{mode:0o600});
await writeFile(path.join(secrets,'user-password'),password,{mode:0o600});
function run(cmd,args,{timeout=1200000,quiet=false}={}) {
  return new Promise((resolve,reject)=>{
    const p=spawn(cmd,args,{windowsHide:true});let out='',err='';
    const timer=setTimeout(()=>{p.kill();reject(Error(`${cmd} timed out`));},timeout);
    p.stdout.on('data',d=>{out+=d;if(!quiet)process.stdout.write(d);});
    p.stderr.on('data',d=>{err+=d;if(!quiet)process.stderr.write(d);});
    p.once('error',e=>{clearTimeout(timer);reject(e);});
    p.once('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(`${cmd} exited ${code}: ${err.replaceAll(password,'[REDACTED]')}`));});
  });
}
let network=false,dc=false,client=false,build=false;
try {
  await run('docker',['build','-t',image,'scripts/auth-realm']);
  await run('docker',['network','create','--label','downloader.fixture=auth',name]);network=true;
  await run('docker',['volume','create','--label','downloader.fixture=auth',`${name}-build`]);build=true;
  await run('docker',['run','-d','--name',`${name}-dc`,'--label','downloader.fixture=auth',
    '--network',name,'--hostname','dc.downloader.test','--network-alias','dc.downloader.test',
    '--publish','127.0.0.1::8080','--mount',`type=bind,source=${secrets},target=/run/secrets,readonly`,image]);dc=true;
  let ready=false;
  for(let attempt=0;attempt<90;attempt++) {
    try{await run('docker',['exec',`${name}-dc`,'test','-f','/tmp/realm-ready'],{quiet:true,timeout:15000});ready=true;break;}catch{}
    const state=(await run('docker',['inspect','--format','{{.State.Running}}',`${name}-dc`],{quiet:true})).trim();
    if(state!=='true')throw Error('Disposable realm exited during provisioning');
    await new Promise(r=>setTimeout(r,1000));
  }
  if(!ready)throw Error('Disposable realm readiness timeout');
  await run('docker',['run','-d','--name',`${name}-client`,'--label','downloader.fixture=auth',
    '--network',name,'--entrypoint','sleep',
    '--mount',`type=bind,source=${process.cwd()},target=/repo,readonly`,
    '--mount',`type=bind,source=${root},target=/evidence`,
    '--mount',`type=bind,source=${secrets},target=/run/secrets,readonly`,
    '--mount',`type=volume,source=${name}-build,target=/build`,image,'infinity']);client=true;
  await run('docker',['exec',`${name}-client`,'bash','-ceu',
    'cp /repo/Cargo.toml /repo/Cargo.lock /tmp/; mkdir -p /tmp/apps/desktop; cp -r /repo/crates /tmp/; cp -r /repo/apps/desktop/src-tauri /tmp/apps/desktop/; cd /tmp; CARGO_BUILD_JOBS=2 CARGO_PROFILE_DEV_DEBUG=0 CARGO_TARGET_DIR=/build cargo build --locked -p downloader-core --example qualify']);
  await run('docker',['cp',`${name}-dc:/etc/krb5.conf`,path.join(root,'krb5.conf')],{quiet:true});
  await run('docker',['exec',`${name}-client`,'bash','-ceu',
    'cp /evidence/krb5.conf /etc/krb5.conf; python3 /repo/scripts/auth-realm/qualify.py']);
  if(process.platform==='win32') {
    const port=(await run('docker',['port',`${name}-dc`,'8080/tcp'],{quiet:true})).trim().split(':').at(-1);
    const data=Buffer.alloc(251*4096);for(let i=0;i<data.length;i++)data[i]=i%251;
    const {createHash}=await import('node:crypto');const sha=createHash('sha256').update(data).digest('hex');
    const results=[];
    for(const mode of ['auth_probe','auth_job'])for(const rejected of [false,true]) {
      const test=`ntlm_${mode==='auth_job'?'job':'domain'}_${rejected?'wrong_password':'valid'}`;const directory=path.join(root,'windows',test);await mkdir(directory,{recursive:true});
      const file=path.join(directory,'case.json');
      await writeFile(file,JSON.stringify({name:test,mode,url:`http://127.0.0.1:${port}/file.bin`,directory,username:'DOWNLOADER\\fixture',password:password+(rejected?'-incorrect':''),sha256:sha,network:{proxy_mode:'direct',authentication:'ntlm',retries:0},...(rejected?{expected_failure:'authentication_required'}:{})}));
      try{results.push(JSON.parse(await run(path.resolve('.local/engine-target/release/examples/qualify.exe'),[file],{quiet:true,timeout:45000})));}finally{await rm(file);}
    }
    await writeFile(path.join(root,'windows','results.json'),JSON.stringify({platform:'windows',results},null,2));
    process.stdout.write(JSON.stringify(results,null,2)+'\n');
  }
  const provenance=JSON.parse(await run('docker',['inspect','--format','{{json .}}',`${name}-dc`],{quiet:true}));
  await writeFile(path.join(root,'provenance.json'),JSON.stringify({image:provenance.Image,realm:'DOWNLOADER.TEST',host_domain_modified:false},null,2));
  const linux=JSON.parse(await readFile(path.join(root,'linux','results.json'),'utf8'));
  const windows=process.platform==='win32'?JSON.parse(await readFile(path.join(root,'windows','results.json'),'utf8')):null;
  await writeFile('.local/auth-realm-results.json',JSON.stringify({realm:'DOWNLOADER.TEST',image:provenance.Image,host_domain_modified:false,linux,windows},null,2));
  console.log(`Sanitized evidence: ${root}`);
} catch(error) {
  if(dc)for(const file of ['/tmp/provision.log','/tmp/user.log','/tmp/keytab-info.log','/tmp/samba.log','/tmp/ntlm.log','/var/log/apache2/error.log']) {
    const raw=path.join(root,`raw-${path.basename(file)}`);
    try { await run('docker',['cp',`${name}-dc:${file}`,raw],{quiet:true,timeout:10000});const log=await readFile(raw,'utf8');await writeFile(path.join(root,path.basename(file)),log.replaceAll(password,'[REDACTED]').replaceAll(adminPassword,'[REDACTED]')); }catch{}finally{await rm(raw,{force:true});}
  }
  console.error(`Fixture diagnostics: ${root}`);
  throw error;
} finally {
  const cleanupErrors=[];
  for(const [owned,args] of [[client,['rm','-f',`${name}-client`]], [dc,['rm','-f',`${name}-dc`]], [network,['network','rm',name]], [build,['volume','rm',`${name}-build`]]]) {
    if(owned)try{await run('docker',args,{quiet:true});}catch(error){cleanupErrors.push(error);}
  }
  const relative=path.relative(root,path.resolve(secrets));
  if(relative!=='secrets')throw Error('Refusing secret cleanup outside the owned fixture directory');
  await rm(secrets,{recursive:true,force:true});
  if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Owned Docker fixture cleanup failed');
}
