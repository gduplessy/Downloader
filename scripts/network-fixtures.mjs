// Bounded loopback HTTP(S)/HTTP2, FTP(S), HTTP/HTTPS proxy and SOCKS fixtures.
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
const listen = server => new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const md5 = s => createHash('md5').update(s).digest('hex');
export async function fixtures(directory) {
  await mkdir(directory,{recursive:true});
  const keyFile=path.join(directory,'key.pem'),certFile=path.join(directory,'cert.pem'),configFile=path.join(directory,'openssl.cnf');
  await writeFile(configFile,'[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=extensions\n[dn]\nCN=localhost\n[extensions]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost,DNS:download-fixture.invalid\n');
  await exec(process.env.OPENSSL ?? 'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','2','-config',configFile],{windowsHide:true});
  const options={key:await readFile(keyFile),cert:await readFile(certFile)};
  const data=Buffer.alloc(32*1024*1024);for(let i=0;i<data.length;i++) data[i]=i%251;
  const sha256=createHash('sha256').update(data).digest('hex');
  const stats={requests:[],proxy:0,socks:0,ftpRest:0,ftpTls:0,maxActive:0,active:0};const activeResponses=new Map();let proxyPort,secureProxyPort,authProxyPort;
  const servers=[],sockets=new Set();
  function track(server) {servers.push(server);server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});});return server;}
  const transient=new Set();
  const largeSize=4*1024**3+16*1024*1024+17;
  const pattern=Buffer.alloc(251*16384);for(let i=0;i<pattern.length;i++)pattern[i]=i%251;
  const largeHash=createHash('sha256');for(let i=0;i<largeSize;i+=pattern.length)largeHash.update(pattern.subarray(0,Math.min(pattern.length,largeSize-i)));
  const largeSha256=largeHash.digest('hex');
  const zipName=Buffer.from('large-offset.txt');const payload=Buffer.from('hello');
  const local=Buffer.alloc(30+zipName.length+payload.length);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(0x3610a686,14);local.writeUInt32LE(5,18);local.writeUInt32LE(5,22);local.writeUInt16LE(zipName.length,26);zipName.copy(local,30);payload.copy(local,30+zipName.length);
  const central=Buffer.alloc(46+zipName.length);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(45,4);central.writeUInt16LE(20,6);central.writeUInt32LE(0x3610a686,16);central.writeUInt32LE(5,20);central.writeUInt32LE(5,24);central.writeUInt16LE(zipName.length,28);zipName.copy(central,46);
  const centralOffset=4*1024**3+4096;const end=Buffer.alloc(56+20+22);end.writeUInt32LE(0x06064b50);end.writeBigUInt64LE(44n,4);end.writeUInt16LE(45,12);end.writeUInt16LE(45,14);end.writeBigUInt64LE(1n,24);end.writeBigUInt64LE(1n,32);end.writeBigUInt64LE(BigInt(central.length),40);end.writeBigUInt64LE(BigInt(centralOffset),48);
  end.writeUInt32LE(0x07064b50,56);end.writeBigUInt64LE(BigInt(centralOffset+central.length),64);end.writeUInt32LE(1,72);end.writeUInt32LE(0x06054b50,76);end.writeUInt16LE(0xffff,84);end.writeUInt16LE(0xffff,86);end.writeUInt32LE(0xffffffff,88);end.writeUInt32LE(0xffffffff,92);
  const zipTail=Buffer.concat([central,end]),zipSize=centralOffset+zipTail.length;
  function zipBytes(position,count){const bytes=Buffer.alloc(count);for(const [offset,source] of [[0,local],[centralOffset,zipTail]]){const from=Math.max(position,offset),to=Math.min(position+count,offset+source.length);if(to>from)source.copy(bytes,from-position,from-offset,to-offset);}return bytes;}

  async function respond(req,res) {
    const url=new URL(req.url,'http://localhost');stats.requests.push({path:url.pathname,version:req.httpVersion,method:req.method,range:req.headers.range});
    req.on('error',()=>{});res.on('error',()=>{});
    if(url.pathname==='/proxy.pac'){res.end(`function FindProxyForURL(url,host){return "PROXY 127.0.0.1:${proxyPort}";}`);return;}
    const pac={
      '/failover.pac':`PROXY 127.0.0.1:1; PROXY 127.0.0.1:${proxyPort}; DIRECT`,
      '/direct.pac':'PROXY 127.0.0.1:1; DIRECT',
      '/unavailable.pac':'PROXY 127.0.0.1:1; PROXY 127.0.0.1:2',
      '/tls-failure.pac':`HTTPS 127.0.0.1:${secureProxyPort}; DIRECT`,
      '/auth-failure.pac':`PROXY 127.0.0.1:${authProxyPort}; DIRECT`,
    }[url.pathname];
    if(pac){res.end(`function FindProxyForURL(url,host){return ${JSON.stringify(pac)};}`);return;}
    if(url.pathname==='/basic' && req.headers.authorization!=='Basic '+Buffer.from('fixture:fixture-password').toString('base64')) {res.writeHead(401,{'WWW-Authenticate':'Basic realm="fixture"','Content-Length':'0'});res.end();return;}
    if(url.pathname==='/digest') {
      const values=Object.fromEntries([...(req.headers.authorization ?? '').matchAll(/(\w+)=(?:"([^"]*)"|([^, ]+))/g)].map(m=>[m[1],m[2]??m[3]]));
      const expected=md5(`${md5('fixture:fixture:fixture-password')}:nonce:${values.nc}:${values.cnonce}:auth:${md5(req.method+':'+values.uri)}`);
      if(values.username!=='fixture' || values.response!==expected){res.writeHead(401,{'WWW-Authenticate':'Digest realm="fixture", nonce="nonce", qop="auth", algorithm=MD5','Content-Length':'0'});res.end();return;}
    }
    if(url.pathname==='/redirect'){res.writeHead(302,{Location:'/file','Content-Length':'0'});res.end();return;}
    if(url.pathname==='/retry' && req.method!=='HEAD' && req.headers.range!=='bytes=0-0' && !transient.has(req.url)) {transient.add(req.url);res.writeHead(503,{'Retry-After':'1','Content-Length':'0'});res.end();return;}
    const cap=Number(url.searchParams.get('cap')??0);
    for(const [response] of activeResponses)if(response.destroyed || response.writableFinished || response.finished)activeResponses.delete(response);
    if(cap && req.method!=='HEAD' && req.headers.range!=='bytes=0-0' && [...activeResponses.values()].filter(group=>group===cap).length>=cap){res.writeHead(429,{'Retry-After':'1','Content-Length':'0'});res.end();return;}
    const size=url.pathname==='/large'  ? largeSize : url.pathname==='/zip64' ? zipSize : data.length;
    let from=0,to=size-1;let ranged=false;
    if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(m){from=Number(m[1]);to=m[2]?Math.min(Number(m[2]),to):to;ranged=true;}}
    if(from>to || to>=size){res.writeHead(416,{'Content-Length':'0'});res.end();return;}
    const compressed=url.pathname==='/compressed';let compressedData;
    if(compressed){from=0;to=size-1;ranged=false;compressedData=gzipSync(data);}
    const headers={'Content-Type':'application/octet-stream','Content-Length':String(compressed?compressedData.length:to-from+1),'Accept-Ranges':'bytes',ETag:'"fixture-v1"','Content-Disposition':"attachment; filename*=UTF-8''%E7%95%8C.bin"};
    if(ranged) headers['Content-Range']=`bytes ${from}-${to}/${size}`;
    if(compressed) headers['Content-Encoding']='gzip';
    res.writeHead(ranged?206:200,headers);if(req.method==='HEAD'){res.end();return;}
    activeResponses.set(res,cap);stats.active=activeResponses.size;stats.maxActive=Math.max(activeResponses.size,stats.maxActive);
    const release=()=>{activeResponses.delete(res);stats.active=activeResponses.size;};res.once('finish',release);res.once('close',release);
    try {
      if(compressed){res.end(compressedData);return;}
      const delay=Number(url.searchParams.get('delay')??0), chunkSize=Number(url.searchParams.get('chunk')??65536);
      for(let position=from;position<=to;position+=chunkSize) {
        if(res.destroyed) break;
        const count=Math.min(chunkSize,to-position+1);
        let bytes;
        if(url.pathname==='/large'){bytes=Buffer.allocUnsafe(count);for(let i=0;i<count;i++)bytes[i]=(position+i)%251;}
        else if(url.pathname==='/zip64')bytes=zipBytes(position,count);
        else bytes=data.subarray(position,position+count);
        if(!res.write(bytes) && !res.destroyed) {await new Promise(resolve=>{const done=()=>{res.removeListener('drain',done);res.removeListener('close',done);resolve();};res.once('drain',done);res.once('close',done);if(res.destroyed)done();});}
        if(delay || url.pathname==='/large' && position>=4*1024**3) await new Promise(resolve=>setTimeout(resolve,delay||2));
      }
      res.end();
    } finally {release();}
  }
  const httpServer=track(http.createServer((req,res)=>void respond(req,res)));const httpPort=await listen(httpServer);
  const httpsServer=track(https.createServer(options,(req,res)=>void respond(req,res)));const httpsPort=await listen(httpsServer);
  const h2Server=track(http2.createSecureServer({...options,allowHTTP1:true},(req,res)=>void respond(req,res)));h2Server.on('sessionError',()=>{});const h2Port=await listen(h2Server);
  function forward(req,res){let target;try{target=new URL(req.url);}catch{res.writeHead(404);res.end();return;}stats.proxy++;if(target.hostname==='download-fixture.invalid')target.hostname='127.0.0.1';const upstream=http.request(target,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);}
  function connect(req,client,head){stats.proxy++;const [host,port]=req.url.split(':');const remote=net.connect(Number(port),host==='download-fixture.invalid'?'127.0.0.1':host,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);});remote.on('error',()=>client.destroy());client.on('error',()=>remote.destroy());client.on('close',()=>remote.destroy());}
  const proxy=track(http.createServer(forward));proxy.on('connect',connect);proxyPort=await listen(proxy);
  const secureProxy=track(https.createServer(options,forward));secureProxy.on('connect',connect);secureProxyPort=await listen(secureProxy);
  const authProxy=track(http.createServer((_req,res)=>{res.writeHead(407,{'Proxy-Authenticate':'Basic realm="fixture"','Content-Length':'0'});res.end();}));
  authProxy.on('connect',(_req,client)=>client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fixture"\r\nContent-Length: 0\r\n\r\n'));
  authProxyPort=await listen(authProxy);
  const socks=track(net.createServer(socket=>{
    let buffer=Buffer.alloc(0),stage=0;let version;
    function receive(chunk){buffer=Buffer.concat([buffer,chunk]);
      if(stage===0){version=buffer[0];if(version===5){if(buffer.length<2+buffer[1])return;buffer=buffer.subarray(2+buffer[1]);socket.write(Buffer.from([5,0]));stage=1;}else if(version===4){stage=1;}else{socket.destroy();return;}}
      if(stage===1){let host,port,consumed;
        if(version===5){if(buffer.length<4)return;port=0;if(buffer[3]===1){if(buffer.length<10)return;host=[...buffer.subarray(4,8)].join('.');port=buffer.readUInt16BE(8);consumed=10;}else if(buffer[3]===3){if(buffer.length<7+buffer[4])return;host=buffer.subarray(5,5+buffer[4]).toString();port=buffer.readUInt16BE(5+buffer[4]);consumed=7+buffer[4];}else{socket.destroy();return;}}
        else{if(buffer.length<9)return;const end=buffer.indexOf(0,8);if(end<0)return;host=[...buffer.subarray(4,8)].join('.');port=buffer.readUInt16BE(2);consumed=end+1;if(host.startsWith('0.0.0.') && buffer[7]!==0){const endHost=buffer.indexOf(0,consumed);if(endHost<0)return;host=buffer.subarray(consumed,endHost).toString();consumed=endHost+1;}}
        stage=2;stats.socks++;socket.removeListener('data',receive);const remainder=buffer.subarray(consumed);const remote=net.connect(port,host,()=>{socket.write(version===5?Buffer.from([5,0,0,1,127,0,0,1,0,0]):Buffer.from([0,90,0,0,0,0,0,0]));if(remainder.length)remote.write(remainder);remote.pipe(socket);socket.pipe(remote);});remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());
      }
    }socket.on('data',receive);
  }));const socksPort=await listen(socks);
  const secureContext=tls.createSecureContext(options);
  function ftp(initial,implicit=false){let socket=initial,buffer='',passive,connection,offset=0,protectedData=implicit;
    function bind(s){socket=s;s.on('error',()=>{});s.on('data',consume);s.on('close',()=>passive?.close());}
    function reply(s){socket.write(s+'\r\n');}
    async function consume(chunk){buffer+=chunk.toString();while(buffer.includes('\r\n')){const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);const [cmd,...rest]=line.split(' ');const arg=rest.join(' ');
      switch(cmd.toUpperCase()){
      case 'AUTH':reply('234 TLS ready');socket.removeListener('data',consume);bind(new tls.TLSSocket(socket,{isServer:true,secureContext}));stats.ftpTls++;break;
      case 'USER':reply('331 Password');break;case 'PASS':reply('230 Login accepted');break;
      case 'SYST':reply('215 UNIX Type: L8');break;case 'PWD':reply('257 "/"');break;case 'TYPE':case 'CWD':case 'PBSZ':reply('200 OK');break;
      case 'PROT':protectedData=arg==='P';reply('200 OK');break;
      case 'FEAT':reply('211-Features\r\n SIZE\r\n MDTM\r\n REST STREAM\r\n EPSV\r\n211 End');break;
      case 'SIZE':reply('213 '+data.length);break;case 'MDTM':reply('213 20261010000000');break;
      case 'REST':offset=Number(arg);stats.ftpRest++;reply('350 Restart accepted');break;
      case 'EPSV':case 'PASV': {
        passive?.close();connection=new Promise(resolve=>{passive=net.createServer(s=>{s.on('error',()=>{});resolve(s);});});const port=await listen(passive);reply(cmd==='EPSV'?`229 Entering Extended Passive Mode (|||${port}|)`:`227 Entering Passive Mode (127,0,0,1,${port>>8},${port&255})`);break;
      }
      case 'RETR': {
        reply('150 Opening data connection');let out=await connection;passive.close();
        if(protectedData){out=new tls.TLSSocket(out,{isServer:true,secureContext});out.on('error',()=>{});await new Promise(resolve=>out.once('secure',resolve));}
        out.end(data.subarray(offset));offset=0;out.once('close',()=>reply('226 Transfer complete'));break;
      }
      case 'QUIT':reply('221 Bye');socket.end();break;default:reply('502 Unsupported');
      }
    }}bind(socket);reply('220 Downloader fixture');
  }
  const ftpServer=track(net.createServer(socket=>ftp(socket)));const ftpPort=await listen(ftpServer);
  const ftpsServer=track(tls.createServer(options,socket=>ftp(socket,true)));const ftpsPort=await listen(ftpsServer);
  return {http:`http://127.0.0.1:${httpPort}`,https:`https://127.0.0.1:${httpsPort}`,h2:`https://127.0.0.1:${h2Port}`,ftp:`ftp://127.0.0.1:${ftpPort}/file.bin`,ftps:`ftps://127.0.0.1:${ftpsPort}/file.bin`,proxy:`http://127.0.0.1:${proxyPort}`,secureProxy:`https://127.0.0.1:${secureProxyPort}`,socksPort,certFile,sha256,largeSha256,largeSize,size:data.length,stats,close:async()=>{for(const socket of sockets)socket.destroy();await Promise.all(servers.map(s=>new Promise(resolve=>s.close(resolve))));}};
}
