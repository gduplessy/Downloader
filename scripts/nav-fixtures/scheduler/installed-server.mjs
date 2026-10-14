import { createServer } from 'node:http';
export async function startSchedulerServer() {
  const requests = [],
    sessions = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture'),
      id = url.searchParams.get('id') ?? 'wait';
    let row = sessions.get(id);
    if (!row) {
      row = { readyAt: Date.now() + (id.startsWith('queue') ? 3600000 : 45000) };
      sessions.set(id, row);
    }
    requests.push({
      method: req.method,
      path: url.pathname,
      id,
      at: Date.now(),
      ready: Date.now() >= row.readyAt,
    });
    if (url.pathname.endsWith('/status')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ready: Date.now() >= row.readyAt }));
      return;
    }
    if (url.pathname.endsWith('/submit')) {
      if (Date.now() < row.readyAt) {
        res.writeHead(429, { 'Retry-After': '30' });
        res.end('Server readiness required');
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end('<p>Server accepted readiness</p>');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      `<!doctype html><html><body><h1>Enforced wait ${id}</h1><div role="timer" data-countdown="1">Wait 1 second</div><form action="/nav-adapters/gofile/submit?id=${id}" method="post"><button disabled data-nav-fixture-control type="submit">Download intended file</button></form><script>setInterval(async()=>{const r=await fetch('/nav-adapters/gofile/status?id=${id}').then(r=>r.json());if(r.ready){document.querySelector('[role=timer]').remove();document.querySelector('button').disabled=false;}},500)</script></body></html>`,
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: 'http://127.0.0.1:' + server.address().port,
    requests,
    sessions,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  };
}
