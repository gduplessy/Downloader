import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
const data = Buffer.alloc(12 * 1024 * 1024);
for (let i = 0; i < data.length; i++) data[i] = i % 251;
const hash = createHash('sha256').update(data).digest('hex');
const html = (body) =>
  '<!doctype html><html><head><meta charset="utf-8"><title>Downloader hosted-file fixture</title><style>body{font:16px system-ui;background:#f1f5f9;color:#152035;max-width:900px;margin:80px auto}header,main,footer{background:white;padding:28px;margin:24px 0;border-radius:12px}button,a{padding:16px;margin:8px;border:0;border-radius:8px;display:inline-block}button,.free{background:#2563eb;color:white}a{background:#172033;color:white}.hint{color:#5b6577}</style></head><body>' +
  body +
  '</body></html>';
const tokens = new Map();
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/hosted') {
    const token = randomBytes(16).toString('hex');
    tokens.set(token, Date.now());
    res.setHeader('Set-Cookie', 'fixture_session=' + token + '; HttpOnly; SameSite=Lax; Path=/');
    res.end(
      html(
        '<header><h1>Sample archive.zip</h1><p>12 MiB · Hosted download fixture</p></header><main><h2>Step 1 of 2</h2><a class="free" href="/step2">Free Download</a><a href="/premium">Premium Download</a><a href="/torrent">Torrent</a></main><footer>Premium and torrent controls are test traps; they must never be followed.</footer>',
      ),
    );
    return;
  }
  if (url.pathname === '/step2') {
    const token = req.headers.cookie?.match(/fixture_session=([a-f0-9]+)/)?.[1];
    if (!token || !tokens.has(token)) {
      res.writeHead(401);
      res.end('Session required');
      return;
    }
    res.end(
      html(
        '<header><h1>Sample archive.zip</h1></header><main><h2>Step 2 of 2</h2><span role="timer" id="countdown">3</span><form method="GET" action="/file.zip"><input type="hidden" name="token" value="' +
          token +
          '"><button id="downloadbtn" disabled>Start Download<span style="display:block;font-size:12px">Your file is ready</span></button></form><a href="/premium">Premium Download</a><a href="/torrent">Torrent</a></main><script>let n=3;const timer=setInterval(()=>{document.getElementById("countdown").textContent=String(--n);if(!n){clearInterval(timer);document.getElementById("downloadbtn").disabled=false}},1000)</script>',
      ),
    );
    return;
  }
  if (url.pathname === '/captcha') {
    res.end(
      html(
        '<main><h2>Human input required</h2><div id="captcha">Complete the site challenge manually.</div><button>Download</button></main>',
      ),
    );
    return;
  }
  if (url.pathname === '/post') {
    res.end(
      html(
        '<main><form method="POST" action="/post-file.zip"><input type="hidden" name="nonce" value="one-use"><button>Start Download</button></form></main>',
      ),
    );
    return;
  }
  if (['/premium', '/torrent'].includes(url.pathname)) {
    console.error('NAVIGATION SAFETY FAILURE: ' + url.pathname);
    res.writeHead(400);
    res.end('Trap followed');
    return;
  }
  if (
    [
      '/file.zip',
      '/direct.bin',
      '/ignored.bin',
      '/unknown.bin',
      '/post-file.zip',
      '/truncated.bin',
    ].includes(url.pathname)
  ) {
    if (
      url.pathname === '/file.zip' &&
      (!tokens.has(url.searchParams.get('token')) ||
        !req.headers.cookie?.includes('fixture_session=' + url.searchParams.get('token')))
    ) {
      res.writeHead(401);
      res.end('Session required');
      return;
    }
    if (url.pathname === '/post-file.zip' && req.method !== 'POST') {
      res.writeHead(405);
      res.end('Non-replayable request');
      return;
    }
    const ranged = url.pathname !== '/ignored.bin' && url.pathname !== '/unknown.bin';
    const range = ranged && req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    res.statusCode = range ? 206 : 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="sample-archive.zip"');
    res.setHeader('ETag', '"fixture-v1"');
    res.setHeader('Accept-Ranges', 'bytes');
    if (url.pathname !== '/unknown.bin') res.setHeader('Content-Length', end - start + 1);
    if (range) res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + data.length);
    console.log(
      req.method + ' ' + url.pathname + ' ' + (req.headers.range ?? 'whole') + ' ' + res.statusCode,
    );
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const body = data.subarray(start, end + 1);
    if (url.pathname === '/truncated.bin') {
      res.write(body.subarray(0, body.length / 2));
      res.destroy();
      return;
    }
    if (url.pathname === '/file.zip' || url.pathname === '/post-file.zip') {
      let offset = 0;
      const timer = setInterval(() => {
        if (res.destroyed) {
          clearInterval(timer);
          return;
        }
        res.write(body.subarray(offset, offset + 256 * 1024));
        offset += 256 * 1024;
        if (offset >= body.length) {
          clearInterval(timer);
          res.end();
        }
      }, 40);
      res.on('close', () => clearInterval(timer));
    } else res.end(body);
    return;
  }
  if (url.pathname === '/manifest') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ bytes: data.length, sha256: hash }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});
server.listen(8129, '127.0.0.1', async () => {
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/fixture.json',
    JSON.stringify({ url: 'http://127.0.0.1:8129', bytes: data.length, sha256: hash }, null, 2),
  );
  console.log('Fixture: http://127.0.0.1:8129/hosted\nSHA-256: ' + hash);
});
