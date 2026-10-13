import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const root = resolve('.local/nav-challenges', 'controls-' + randomUUID());
await mkdir(root, { recursive: true });
const env = { ...process.env, DOWNLOADER_DATA_DIR: resolve(root, 'state') },
  cli = resolve(
    process.env.DOWNLOADER_CLI ??
      'target/debug/downloader' + (process.platform === 'win32' ? '.exe' : ''),
  );
function call(...args) {
  return new Promise((resolveCall, reject) => {
    const child = spawn(cli, ['--json', ...args], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    const timeout = setTimeout(() => {
      child.kill();
      reject(Error('Native deadline'));
    }, 60000);
    child.on('error', reject);
    child.on('exit', (code) =>
      setTimeout(() => {
        clearTimeout(timeout);
        child.stdout.destroy();
        child.stderr.destroy();
        try {
          if (code !== 0) throw Error(err);
          resolveCall(JSON.parse(out));
        } catch (e) {
          reject(e);
        }
      }, 25),
    );
  });
}
const solver = createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ msg: 'FlareSolverr is ready!', version: 'fixture-1.0' }));
});
await new Promise((r) => solver.listen(0, '127.0.0.1', r));
const snapshot = await call('settings');
snapshot.settings.solver.endpoint = 'http://127.0.0.1:' + solver.address().port + '/';
snapshot.settings.network.proxy_mode = 'direct';
snapshot.settings.directory = resolve(root, 'output');
snapshot.settings.captcha = {
  enabled: false,
  external_opt_in: false,
  key_ref: '',
  task_ceiling_microusd: 0,
  total_budget_microusd: 0,
};
await writeFile(resolve(root, 'settings.json'), JSON.stringify(snapshot.settings));
await call('set', resolve(root, 'settings.json'));
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/state') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(await call('settings')));
      return;
    }
    if (req.url === '/controls.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile('.local/nav-challenges/controls.js'));
      return;
    }
    if (req.url === '/command' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 64000) throw Error('Request too large');
      }
      const { command, args } = JSON.parse(body);
      let result;
      if (command === 'settings') {
        if (
          args.captcha.total_budget_microusd !== 0 ||
          args.captcha.enabled ||
          args.captcha.external_opt_in
        )
          throw Error('Paid solving forbidden in fixture');
        await writeFile(resolve(root, 'settings.json'), JSON.stringify(args));
        result = await call('set', resolve(root, 'settings.json'));
      } else if (command === 'test_solver')
        result = await call('solver-test', '--endpoint', args.settings.endpoint);
      else if (command === 'restart') {
        await call('quit');
        result = await call('settings');
      } else throw Error('Fixture command denied');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<html><head><title>Production solver controls fixture</title></head><body><div id="root"></div><script type="module" src="/controls.js"></script></body></html>',
    );
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
console.log('http://127.0.0.1:' + server.address().port + '/');
async function close() {
  await call('quit').catch(() => {});
  server.close();
  solver.close();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
