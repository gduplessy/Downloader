// Format/fill only a newly created 128 MiB image; never fill the workspace filesystem.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fixtures } from './network-fixtures.mjs';
const root=path.resolve('.local',`filesystem-${Date.now()}-${process.pid}`);
await mkdir(root,{recursive:true});
const volume=path.join(root,'volume'), image=path.join(root,'filesystem.img');
const binary=path.resolve(process.env.QUALIFY_FS_BINARY??'.local/engine-target/release/examples/qualify_filesystem'+(process.platform==='win32'?'.exe':''));
function run(command,args,timeout=180000){return new Promise((resolve,reject)=>{let out='',err='';const child=spawn(command,args,{windowsHide:true});const timer=setTimeout(()=>child.kill(),timeout);child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(`${command}: ${code}\n${err}\n${out}`));});});}
let mounted=false, target=volume, server;
try {
  if(process.platform==='win32'){
    target=JSON.parse(await run('powershell.exe',['-NoProfile','-File','scripts/provision-filesystem.ps1','-FixtureRoot',root])).volume;
    mounted=true;
  } else if(process.platform==='linux'){
    await mkdir(volume);await run('truncate',['-s','128M',image]);await run('mkfs.ext4',['-F',image]);
    await run('sudo',['mount','-o','loop',image,volume]);mounted=true;
    await run('sudo',['chown',`${process.getuid()}:${process.getgid()}`,volume]);
  } else if(process.platform==='darwin'){
    const macImage=path.join(root,'filesystem.dmg');
    await mkdir(volume);await run('hdiutil',['create','-size','128m','-fs','HFS+','-volname','DownloaderFixture',macImage]);
    await run('hdiutil',['attach',macImage,'-nobrowse','-mountpoint',volume]);mounted=true;
  } else throw Error('Unsupported filesystem fixture platform');
  if((await stat(root)).dev===(await stat(target)).dev)throw Error('Refusing to fill a fixture on the workspace device');
  await writeFile(path.join(target,'.downloader-disposable-volume'),root);
  server=await fixtures(path.join(root,'certificates'));
  const config=path.join(root,'case.json');await writeFile(config,JSON.stringify({directory:root,volume:target,url:server.http+'/file',sha256:server.sha256}));
  const result=JSON.parse(await run(binary,[config]));
  await writeFile(path.join(root,'results.json'),JSON.stringify(result,null,2));
  // Stable artifact name avoids publishing fixture paths/credentials or the filesystem image.
  await writeFile('.local/filesystem-results.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  if(server)await server.close();
  if(mounted){
    if(process.platform==='win32')await run('powershell.exe',['-NoProfile','-File','scripts/provision-filesystem.ps1','-FixtureRoot',root,'-Detach']);
    else if(process.platform==='linux')await run('sudo',['umount',volume]);
    else await run('hdiutil',['detach',volume]);
  }
}
