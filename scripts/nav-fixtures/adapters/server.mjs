import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export const providers = ['g4u', 'ddownload', 'rapidgator', 'gofile'];
export const payload = Buffer.from('Downloader NAV adapter fixture v1\n'.repeat(128));
export const expectedHash = createHash('sha256').update(payload).digest('hex');
const html = (body) =>
  '<!doctype html><meta charset="utf-8"><title>Synthetic NAV adapter fixture</title><style>body{font:16px system-ui;max-width:850px;margin:40px auto}button,a{display:inline-block;padding:14px;margin:8px}section{padding:12px;border:1px solid #bbc}h1{font-size:24px}</style><h1>Synthetic adapter fixture — no live-provider layout claim</h1>' +
  body +
  '<script src="/harness.js"></script>';
export function fixtureHtml(provider, scenario) {
  if (!providers.includes(provider)) throw Error('Unknown fixture provider');
  const prefix = `/nav-adapters/${provider}`;
  const a = (label = 'Download', extra = '') =>
    `<a data-nav-fixture-control ${extra} href="${prefix}/file.bin">${label}</a>`;
  const scenarios = {
    submitter: `<form method="POST" action="/trap/purchase"><input type="hidden" name="fixture" value="public"><button data-nav-fixture-control formmethod="GET" formaction="${prefix}/file.bin" name="step" value="actual">Download</button></form>`,
    hidden: '<div style="display:none">' + a() + '</div>' + a('Download', 'id="visible"'),
    script: `<form action="${prefix}/file.bin"><button type="button">Download</button></form>`,
    token:
      `<form method="GET" action="${prefix}/file.bin"><input id="token" type="hidden" name="token" value="public-one"><button>Download</button></form>` +
      a(),
    closed:
      '<div id="closed"></div><script>document.querySelector("#closed").attachShadow({mode:"closed"}).innerHTML=' +
      JSON.stringify(a()) +
      '</script>',
    get: `<form method="GET" action="${prefix}/file.bin"><input type="hidden" name="fixture" value="public"><button data-nav-fixture-control>Download</button></form>`,
    post: `<form method="POST" action="${prefix}/one-use.bin"><input type="hidden" name="token" value="fixture-public-one-use"><button data-nav-fixture-control>Start Download</button></form>`,
    ambiguous: a() + a('Download', 'id="second"'),
    ads:
      `<div data-ad>${a()}</div>` +
      a('Start Download', 'id="intended"') +
      '<a href="/trap/purchase">Buy premium</a><a href="magnet:?xt=fixture">Download torrent</a>',
    localized: a('Télécharger le fichier') + a('Descargar archivo'),
    shadow:
      '<div id="shadow"></div><script>const root=document.querySelector("#shadow").attachShadow({mode:"open"});root.innerHTML=' +
      JSON.stringify(a()) +
      '</script>',
    replaced: a('Download', 'id="replace"') + a('Download', 'id="second"'),
    wait: `<span role="timer">2</span><button disabled data-nav-fixture-control form="waitform">Start Download</button><form id="waitform" action="${prefix}/file.bin"></form>`,
    unsafe:
      '<a data-nav-fixture-control href="javascript:alert(1)">Download</a><a data-nav-fixture-control href="data:text/plain,trap">Download</a>',
    login: '<input type="password" aria-label="Password">' + a(),
    expired: '<p>Link expired</p>' + a(),
    changed: '<button>Unrecognized changed layout</button><a href="/trap/purchase">Buy premium</a>',
    chosen: `<section data-download-host="rapidgator.net"><h2>Rapidgator</h2>${a('Part 1')}</section><section data-download-host="ddownload.com"><h2>ddownload</h2>${a('Part 1', 'id="dd1"')}${a('Part 2', 'id="dd2"')}</section>`,
  };
  if (!(scenario in scenarios)) throw Error('Unknown fixture scenario');
  return html(scenarios[scenario]);
}
export async function startAdapterFixtureServer({
  port = 18765,
  harness = '.local/nav-adapters/harness.js',
} = {}) {
  const requests = [];
  const spent = new Set();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/harness.js') {
      try {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(await readFile(harness));
      } catch {
        res.writeHead(404);
        res.end('Build the fixture harness first');
      }
      return;
    }
    if (url.pathname === '/status') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ requests, expectedHash }));
      return;
    }
    if (url.pathname.startsWith('/trap/')) {
      requests.push({ method: req.method, path: url.pathname, outcome: 'trap' });
      res.writeHead(400);
      res.end('Unsafe control followed');
      return;
    }
    if (parts[0] !== 'nav-adapters' || !providers.includes(parts[1])) {
      res.writeHead(404);
      res.end();
      return;
    }
    const provider = parts[1],
      scenario = parts[2];
    if (scenario === 'redirect') {
      res.writeHead(302, { Location: `/nav-adapters/${provider}/get` });
      res.end();
      return;
    }
    if (scenario === 'file.bin' || scenario === 'one-use.bin') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      if (
        scenario === 'one-use.bin' &&
        (req.method !== 'POST' ||
          new URLSearchParams(body).get('token') !== 'fixture-public-one-use' ||
          spent.has(provider))
      ) {
        res.writeHead(409);
        res.end('One-use POST required');
        return;
      }
      if (scenario === 'one-use.bin') spent.add(provider);
      requests.push({
        method: req.method,
        path: url.pathname,
        provider,
        filename: `${provider}-fixture.bin`,
        sha256: expectedHash,
        outcome: 'file',
      });
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${provider}-fixture.bin"`,
        'Content-Length': payload.length,
        'Cache-Control': 'no-store',
      });
      res.end(payload);
      return;
    }
    try {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(fixtureHtml(provider, scenario));
    } catch {
      res.writeHead(404);
      res.end('Unknown fixture scenario');
    }
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  return {
    server,
    requests,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await startAdapterFixtureServer({
    port: Number(process.env.NAV_ADAPTER_PORT ?? 18765),
  });
  console.log(`Synthetic adapter fixtures: ${fixture.base}/nav-adapters/g4u/chosen`);
}
