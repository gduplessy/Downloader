import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const dom = JSON.parse(await readFile('.local/nav-challenges/dom-result.json', 'utf8'));
const root = resolve('.local/nav-challenges', 'desktop-' + randomUUID()),
  env = { ...process.env, DOWNLOADER_DATA_DIR: resolve(root, 'state') },
  cli = resolve(
    process.env.DOWNLOADER_CLI ??
      'target/debug/downloader' + (process.platform === 'win32' ? '.exe' : ''),
  );
await mkdir(root, { recursive: true });
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
      reject(Error('CLI deadline'));
    }, 60000);
    child.on('error', reject);
    child.on('exit', (code) =>
      setTimeout(() => {
        clearTimeout(timeout);
        child.stdout.destroy();
        child.stderr.destroy();
        try {
          assert.equal(code, 0, err);
          resolveCall(JSON.parse(out));
        } catch (e) {
          reject(e);
        }
      }, 25),
    );
  });
}
const rows = [];
try {
  for (const row of dom.rows) {
    const job = await call(
      'add',
      row.link,
      '--directory',
      root,
      '--filename',
      row.provider + '-intended.bin',
      '--sha256',
      row.hash,
    );
    const id = job.id;
    const deadline = Date.now() + 30000;
    let completed;
    while (Date.now() < deadline) {
      const snapshot = await call('list');
      const jobs = Array.isArray(snapshot) ? snapshot : snapshot.jobs;
      const current = jobs.find((j) => j.id === id);
      if (current?.state === 'complete') {
        completed = current;
        break;
      }
      if (current?.state === 'failed') throw Error(current.error);
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(completed, 'Desktop completion missing');
    const bytes = await readFile(resolve(root, row.provider + '-intended.bin'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, row.hash);
    rows.push({
      provider: row.provider,
      selected_host: row.selected_host,
      bytes: bytes.length,
      sha256: hash,
      native_desktop_state: completed.state,
    });
  }
  const diagnostics = await call('diagnostics');
  const evidence = {
    fixture: 'challenge-fresh-link-desktop-v1',
    browser: dom.browser,
    native_product_version: diagnostics.version,
    cli_sha256: createHash('sha256')
      .update(await readFile(cli))
      .digest('hex'),
    rows,
    cancelled_submissions: dom.cancelled_submissions,
    stale_rows: dom.stale_rows,
    qualification:
      'Production page module with mocked worker; extracted fresh links then real CLI desktop transfer. Installed worker/navigation path still pending.',
  };
  await writeFile(
    '.local/nav-challenges/desktop-result.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await call('quit').catch(() => {});
}
