import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
export const payload = Buffer.from(
  'nav-challenge-intended-file-v1\n'.repeat(8192),
);
export const expectedHash = createHash('sha256').update(payload).digest('hex');
export async function startChallengeServer({
  downloadLane = 'attachment',
} = {}) {
  const requests = [],
    submits = [],
    tokens = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'),
      parts = url.pathname.split('/'),
      provider = parts[2] ?? 'g4u';
    requests.push({ method: req.method, path: url.pathname });
    if (url.pathname === '/harness.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile('.local/nav-challenges/harness.js'));
      return;
    }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<html><body><h1>Synthetic challenge fixture</h1><script src="/harness.js"></script></body></html>',
      );
      return;
    }
    if (!['g4u', 'ddownload', 'rapidgator', 'gofile'].includes(provider)) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (parts[3] === 'image.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="white"/><circle cx="150" cy="58" r="22" fill="none" stroke="#232323" stroke-width="4"/><path d="M64.6 59 L65 55 A20 20 0 1 0 57.4 70.7" fill="none" stroke="#232323" stroke-width="4"/></svg>',
      );
      return;
    }
    if (parts[3] === 'submit' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      const data = new URLSearchParams(body),
        x = Number(data.get('captcha_x')),
        y = Number(data.get('captcha_y')),
        host = data.get('selected_host');
      if (
        data.get('csrf') !== 'public-fixture-csrf-v1' ||
        !['ddownload.com', 'rapidgator.net', 'gofile.io'].includes(host) ||
        Math.hypot(x - 45, y - 55) > 4
      ) {
        submits.push({ provider, accepted: false });
        res.writeHead(403);
        res.end('Rejected');
        return;
      }
      const token = 'public-fixture-' + provider + '-' + submits.length;
      tokens.set(token, { provider, host });
      submits.push({ provider, host, accepted: true });
      res.setHeader('Content-Type', 'text/html');
      if (downloadLane === 'blob') {
        const path = '/nav-challenges/' + provider + '/file.bin?token=' + token;
        res.end(
          '<html><body><h1>Accepted selected-host challenge</h1><button id="prepare-download">Prepare permitted fixture download</button><section id="fresh-links" data-download-host="' +
            host +
            '" data-group="fresh"></section><script>document.getElementById("prepare-download").onclick=async()=>{const response=await fetch(' +
            JSON.stringify(path) +
            ');if(!response.ok)throw Error("Fixture file refused");const blob=await response.blob();const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.textContent="Download intended file";link.dataset.provider=' +
            JSON.stringify(host) +
            ';link.download="challenge-fixture.bin";document.getElementById("fresh-links").append(link);document.documentElement.dataset.fixtureBlobReady="true"}</script></body></html>',
        );
        return;
      }
      res.end(
        '<section data-download-host="' +
          host +
          '" data-group="fresh"><a data-provider="' +
          host +
          '" href="/nav-challenges/' +
          provider +
          '/file.bin?token=' +
          token +
          '">Download intended file</a></section>',
      );
      return;
    }
    if (parts[3] === 'file.bin') {
      const token = tokens.get(url.searchParams.get('token'));
      if (!token || token.provider !== provider) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', payload.length);
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=challenge-fixture.bin',
      );
      res.setHeader('Accept-Ranges', 'bytes');
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
      if (range) {
        const start = Number(range[1]),
          end = Math.min(Number(range[2]), payload.length - 1);
        res.writeHead(206, {
          'Content-Range': 'bytes ' + start + '-' + end + '/' + payload.length,
          'Content-Length': end - start + 1,
        });
        res.end(
          req.method === 'HEAD' ? undefined : payload.subarray(start, end + 1),
        );
      } else res.end(req.method === 'HEAD' ? undefined : payload);
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<html><body><h1>Synthetic ' +
        provider +
        ' image challenge</h1><form method="POST" action="/nav-challenges/' +
        provider +
        '/submit"><input type="hidden" name="csrf" value="public-fixture-csrf-v1"><input type="hidden" name="selected_host" value="gofile.io"><input type="hidden" name="captcha_x"><input type="hidden" name="captcha_y"><img src="/nav-challenges/' +
        provider +
        '/image.svg" data-downloader-challenge="open-circle-v1" data-instruction="Click the open circle" data-expires-at="' +
        (Date.now() + 300000) +
        '" style="width:240px;height:120px;border:4px solid blue"><button type="submit">Submit challenge</button></form></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    base,
    submits,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
if (process.argv[1]?.endsWith('server.mjs')) {
  const fixture = await startChallengeServer();
  await mkdir('.local/nav-challenges', { recursive: true });
  await writeFile(
    '.local/nav-challenges/server.json',
    JSON.stringify({ base: fixture.base, expectedHash }),
  );
  console.log(fixture.base);
  process.on('SIGTERM', () => void fixture.close().then(() => process.exit(0)));
}
