import { createServer } from 'node:http';
export async function startRetryAfterServer() {
  const requests = [],
    cases = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture'),
      name = url.searchParams.get('case') ?? 'numeric';
    const row = cases.get(name) ?? { readyAt: null };
    cases.set(name, row);
    requests.push({
      method: req.method,
      path: url.pathname,
      name,
      at: Date.now(),
      ready: row.readyAt !== null && Date.now() >= row.readyAt,
    });
    res.setHeader('Content-Type', 'text/html');
    if (url.pathname.endsWith('/submit')) {
      if (Date.now() < row.readyAt) {
        res.writeHead(429);
        res.end('Too early');
        return;
      }
      res.end('<p>Accepted once</p>');
      return;
    }
    if (url.pathname.endsWith('/status')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ready: Date.now() >= row.readyAt }));
      return;
    }
    if (url.pathname.endsWith('/noise')) {
      res.writeHead(503, { 'Retry-After': '120' });
      res.end('Unrelated fetch');
      return;
    }
    if (url.pathname.endsWith('/limited')) {
      let header;
      if (name === 'date') {
        header = new Date(Date.now() + 12000).toUTCString();
        row.readyAt = Date.parse(header);
      } else if (name === 'malformed' || name === 'oversized') {
        header = name === 'malformed' ? 'invalid-delay' : '9'.repeat(129);
        row.readyAt = Date.now() + 4000;
      } else {
        header = '12';
        row.readyAt = Date.now() + 12000;
      }
      res.writeHead(name === 'date' ? 503 : 429, { 'Retry-After': header });
      const guarded = ['malformed', 'oversized'].includes(name);
      res.end(`<!doctype html><html><body><h1>Server limit ${name}</h1><div role="timer" data-countdown="1">Wait 1 second</div><form method="post" action="/nav-adapters/gofile/submit?case=${name}"><button disabled data-nav-fixture-control type="submit">Download intended file</button></form><script>
        const ready=()=>{document.querySelector('[role=timer]')?.remove();document.querySelector('button').disabled=false;};
        ${guarded ? `setInterval(async()=>{if((await fetch('/nav-adapters/gofile/status?case=${name}').then(r=>r.json())).ready)ready();},250);` : 'setTimeout(ready,1000);'}
        ${name === 'repeated' ? "setInterval(()=>fetch('/nav-adapters/gofile/noise?case=repeated'),500);" : ''}
        </script></body></html>`);
      return;
    }
    res.end(
      `<!doctype html><html><body><h1>Owned starting page</h1><a data-nav-fixture-control href="/nav-adapters/gofile/limited?case=${name}">Download intended file</a></body></html>`,
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: 'http://127.0.0.1:' + server.address().port,
    requests,
    cases,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  };
}
