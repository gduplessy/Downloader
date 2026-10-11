// Opt-in integration qualification against a real local FlareSolverr service.
// Creates a separate Downloader data directory; never touches production jobs.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const endpoint = process.env.SOLVER_ENDPOINT ?? 'http://localhost:9191/';
const host = process.env.FIXTURE_HOST ?? 'host.docker.internal';
const output = resolve('.local', `solver-qualification-${randomUUID()}`);
await mkdir(output, { recursive: true });
const env = { ...process.env, DOWNLOADER_DATA_DIR: resolve(output, 'engine') };
const cli = resolve(
  process.env.DOWNLOADER_CLI ??
    `target/debug/downloader${process.platform === 'win32' ? '.exe' : ''}`,
);
const call = (...args) =>
  new Promise((resolveCall, reject) => {
    const child = spawn(cli, ['--json', ...args], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('CLI command deadline exceeded'));
    }, 90000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    // Windows daemon descendants can retain inherited pipe handles after CLI exit.
    // Wait for the actual command process, not its descendants' pipe-close event.
    child.on('exit', (code) =>
      setTimeout(() => {
        clearTimeout(timer);
        child.stdout.destroy();
        child.stderr.destroy();
        try {
          assert.equal(code, 0, stderr);
          resolveCall(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      }, 25),
    );
  });
const data = Buffer.alloc(2 * 1024 * 1024);
for (let i = 0; i < data.length; i++) data[i] = i % 251;
const hash = createHash('sha256').update(data).digest('hex');
const events = { rangeRequests: 0, cookieRequests: 0, matchingAgent: 0, fileGets: 0 };
const server = createServer((req, res) => {
  if (req.url === '/file.bin') {
    const validCookie = req.headers.cookie?.includes('fixture_clearance=local_fixture');
    const validAgent = req.headers['user-agent']?.includes('Chrome/');
    if (!validCookie || !validAgent) {
      res.writeHead(403);
      res.end();
      return;
    }
    events.cookieRequests++;
    events.matchingAgent++;
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      'Content-Disposition': 'attachment; filename=solver-fixture.bin',
      'Accept-Ranges': 'bytes',
      ETag: '"solver-fixture-v1"',
    };
    if (range) {
      headers['Content-Range'] = `bytes ${start}-${end}/${data.length}`;
      events.rangeRequests++;
    }
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    events.fileGets++;
    // Slow enough to exercise pause/resume, without a production payload.
    let position = start;
    const timer = setInterval(() => {
      const next = Math.min(position + 16384, end + 1);
      res.write(data.subarray(position, next));
      position = next;
      if (position > end) {
        clearInterval(timer);
        res.end();
      }
    }, 20);
    res.on('close', () => clearInterval(timer));
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/expired') {
    res.end('<html>Link expired. Please call up download again and solve captcha.</html>');
    return;
  }
  if (req.url === '/captcha') {
    res.end(
      '<html><img id="captchaImage" alt="custom captcha"><a href="/file.bin">Download</a></html>',
    );
    return;
  }
  // An ordinary rendered-JavaScript page. This is NOT real Cloudflare evidence.
  res.end(
    '<!doctype html><html><body><div id="source"></div><script>document.cookie="fixture_clearance=local_fixture; Path=/; SameSite=Lax"; const a=document.createElement("a"); a.href="/file.bin"; a.textContent="Free Download"; document.getElementById("source").appendChild(a);</script></body></html>',
  );
});
await new Promise((r) => server.listen(0, '0.0.0.0', r));
const origin = `http://${host}:${server.address().port}`;
const started = Date.now();
const evidence = {
  service: null,
  elapsedSeconds: 0,
  renderedSource: {},
  customCaptcha: {},
  expiredSource: {},
  events,
};
async function waitFor(id, predicate) {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const job = (await call('list')).jobs.find((j) => j.id === id);
    if (predicate(job)) return job;
    if (['failed', 'waiting_authentication', 'waiting_source', 'waiting_user'].includes(job.state))
      throw Error(
        `Qualification stopped: ${job.state} ${job.solver_outcome ?? job.failure?.code ?? ''}`,
      );
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error('Qualification deadline exceeded');
}
try {
  const healthStarted = Date.now();
  evidence.service = await call('solver-test', '--endpoint', endpoint);
  evidence.serviceSeconds = (Date.now() - healthStarted) / 1000;
  console.error(`Local service ready: ${evidence.service.version}`);
  const renderStarted = Date.now();
  const probe = await fetch(new URL('v1', endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'request.get', url: `${origin}/page`, maxTimeout: 60000 }),
    signal: AbortSignal.timeout(70000),
  }).then((r) => r.json());
  evidence.browserRendering = {
    status: probe.status,
    httpStatus: probe.solution?.status,
    renderedAnchor: probe.solution?.response?.includes('<a href="/file.bin">Free Download</a>'),
    fixtureCookie: probe.solution?.cookies?.some((c) => c.name === 'fixture_clearance'),
    targetMatches: probe.solution?.url === `${origin}/page`,
  };
  console.error(JSON.stringify(evidence.browserRendering));
  assert.equal(evidence.browserRendering.renderedAnchor, true);
  assert.equal(evidence.browserRendering.fixtureCookie, true);
  evidence.browserRendering.seconds = (Date.now() - renderStarted) / 1000;
  const settings = (await call('settings')).settings;
  Object.assign(settings, {
    directory: output,
    categories: [],
    speed_limit: 512 * 1024,
    connections: 2,
  });
  settings.network.proxy_mode = 'direct';
  settings.solver = { enabled: true, endpoint, timeout_seconds: 60 };
  const settingsPath = resolve(output, 'settings.json');
  await writeFile(settingsPath, JSON.stringify(settings));
  await call('set', settingsPath);
  console.error('Isolated Downloader settings saved');
  const job = await call(
    'add',
    `${origin}/page`,
    '--navigate',
    '--directory',
    output,
    '--sha256',
    hash,
  );
  const solveStarted = Date.now();
  await call('solve', job.id);
  const resolved = await waitFor(job.id, (j) => j.solver_outcome === 'solver_resolved');
  evidence.sourceResolution = {
    outcome: resolved.solver_outcome,
    seconds: (Date.now() - solveStarted) / 1000,
  };
  await waitFor(job.id, (j) => j.bytes > 65536 && j.state === 'downloading');
  await call('pause', job.id);
  const paused = await waitFor(job.id, (j) => j.state === 'paused');
  const pauseBytes = paused.bytes;
  await call('resume', job.id);
  const complete = await waitFor(job.id, (j) => j.state === 'complete');
  const bytes = await readFile(complete.destination);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
  assert.equal(complete.verified_sha256, hash);
  assert.ok(events.rangeRequests > 0 && pauseBytes > 0);
  evidence.renderedSource = {
    state: complete.state,
    bytes: bytes.length,
    sha256: hash,
    pausedBytes: pauseBytes,
    resumable: complete.resumable,
    solveAndTransferSeconds: (Date.now() - solveStarted) / 1000,
  };
  for (const [path, outcome, key] of [
    ['/captcha', 'solver_captcha', 'customCaptcha'],
    ['/expired', 'solver_expired', 'expiredSource'],
  ]) {
    const j = await call('add', `${origin}${path}`, '--navigate', '--directory', output);
    const at = Date.now();
    await call('solve', j.id);
    const stopped = await waitFor(j.id, (v) => v.state === 'waiting_user');
    assert.equal(stopped.solver_outcome, outcome);
    assert.equal(stopped.bytes, 0);
    evidence[key] = { outcome, bytes: stopped.bytes, seconds: (Date.now() - at) / 1000 };
  }
  const diagnostic = JSON.stringify(await call('diagnostics'));
  assert.ok(
    !diagnostic.includes('local_fixture') &&
      !diagnostic.includes('fixture_clearance') &&
      !diagnostic.includes('<html'),
  );
  evidence.elapsedSeconds = (Date.now() - started) / 1000;
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try {
    await call('quit');
  } catch {}
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
