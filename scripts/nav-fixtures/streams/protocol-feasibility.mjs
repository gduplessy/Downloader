import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
// This gate uses real browser protocol response streams, not a replay or file import.
// Extension debugger permission/attachment is qualified by the extension runner separately.
const executable =
  process.env.NAV_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = resolve('.fixture-streams', 'protocol-' + Date.now());
await mkdir(dir, { recursive: true });
const payload = Buffer.alloc(8 * 1024 * 1024 + 17);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) % 251;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<form method="POST" action="/one-use"><input name="token" value="fixture-token"><button>Download</button></form>',
    );
  } else if (req.url === '/one-use') {
    const body = [];
    for await (const chunk of req) body.push(chunk);
    requests.push({ method: req.method, body: Buffer.concat(body).toString() });
    if (requests.length !== 1 || req.method !== 'POST') {
      res.writeHead(410);
      res.end('consumed');
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="fixture.bin"');
    res.setHeader('Content-Length', payload.length);
    res.end(payload);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const proc = spawn(
  executable,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + dir,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
let stderr = '';
const endpoint = await new Promise((resolveEndpoint, reject) => {
  const timeout = setTimeout(
    () => reject(Error('Browser CDP startup timed out: ' + stderr)),
    15000,
  );
  proc.stderr.on('data', (data) => {
    stderr += data;
    const found = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
    if (found) {
      clearTimeout(timeout);
      resolveEndpoint(found[1]);
    }
  });
  proc.once('error', reject);
});
const ws = new WebSocket(endpoint);
await new Promise((r, reject) => {
  ws.onopen = r;
  ws.onerror = reject;
});
let id = 0;
const pending = new Map();
const listeners = new Map();
ws.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) {
    const waiter = pending.get(event.id);
    pending.delete(event.id);
    event.error ? waiter?.reject(Error(event.error.message)) : waiter?.resolve(event.result);
  } else
    for (const listener of listeners.get(event.method) || [])
      listener(event.params, event.sessionId);
};
function command(method, params = {}, sessionId) {
  const next = ++id;
  const result = new Promise((resolveResult, reject) =>
    pending.set(next, { resolve: resolveResult, reject }),
  );
  ws.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
  return result;
}
try {
  const version = await command('Browser.getVersion');
  const { targetId } = await command('Target.createTarget', { url: base });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  await command('Page.enable', {}, sessionId);
  await command('Runtime.enable', {}, sessionId);
  for (let attempts = 0; attempts < 100; attempts++) {
    const ready = await command(
      'Runtime.evaluate',
      { expression: '!!document.querySelector("form")', returnByValue: true },
      sessionId,
    );
    if (ready.result.value) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await command(
    'Fetch.enable',
    { patterns: [{ urlPattern: base + '/one-use', requestStage: 'Response' }] },
    sessionId,
  );
  const captured = new Promise((resolveCapture, reject) => {
    listeners.set('Fetch.requestPaused', [
      async (event, session) => {
        if (session !== sessionId) return;
        try {
          assert.equal(event.request.method, 'POST');
          const { stream } = await command(
            'Fetch.takeResponseBodyAsStream',
            { requestId: event.requestId },
            sessionId,
          );
          const chunks = [];
          let maximum = 0;
          for (;;) {
            const part = await command('IO.read', { handle: stream, size: 192 * 1024 }, sessionId);
            const bytes = Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8');
            maximum = Math.max(maximum, bytes.length);
            chunks.push(bytes);
            if (part.eof) break;
          }
          await command('IO.close', { handle: stream }, sessionId);
          // Taking the original body is irreversible. Close the original response explicitly.
          await command(
            'Fetch.fulfillRequest',
            { requestId: event.requestId, responseCode: 204, body: '' },
            sessionId,
          );
          resolveCapture({ bytes: Buffer.concat(chunks), maximum });
        } catch (error) {
          reject(error);
        }
      },
    ]);
  });
  await command(
    'Runtime.evaluate',
    { expression: 'document.querySelector("form").submit()' },
    sessionId,
  );
  const result = await Promise.race([
    captured,
    new Promise((_, reject) => setTimeout(() => reject(Error('Response stream timed out')), 20000)),
  ]);
  assert.equal(digest(result.bytes), digest(payload));
  assert.deepEqual(requests, [{ method: 'POST', body: 'token=fixture-token' }]);
  assert.ok(result.maximum <= 192 * 1024);
  await writeFile(resolve(dir, 'original-post.bin'), result.bytes);
  // A page-owned Blob is resolved in the original page context with bounded reads.
  await command(
    'Runtime.evaluate',
    {
      expression: `(async()=>{globalThis.fixtureBlob = URL.createObjectURL(new Blob([new Uint8Array(${JSON.stringify([...payload.subarray(0, 1024)])})])); globalThis.fixtureReader = (await fetch(fixtureBlob)).body.getReader();})()`,
      awaitPromise: true,
    },
    sessionId,
  );
  const blob = await command(
    'Runtime.evaluate',
    {
      expression:
        '(async()=>{const {value}=await fixtureReader.read(); return Array.from(value)})()',
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  );
  assert.equal(digest(Buffer.from(blob.result.value)), digest(payload.subarray(0, 1024)));
  const evidence = {
    browser: version.product,
    os: process.platform,
    architecture: process.arch,
    protocolPost: {
      submissions: requests.length,
      bytes: result.bytes.length,
      sha256: digest(result.bytes),
      maxChunkBytes: result.maximum,
    },
    blob: { bytes: 1024, sha256: digest(Buffer.from(blob.result.value)) },
    limitations: [
      'CDP feasibility gate; actual extension/native transport qualification is separate',
      'No live hosts/accounts qualified',
    ],
  };
  await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await command('Browser.close').catch(() => {});
  ws.close();
  proc.kill();
  server.close();
}
