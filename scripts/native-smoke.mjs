import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const id = (await import('node:fs/promises')).readFile;
const extensionId = (await id('apps/extension/dist/extension-id.txt', 'utf8')).trim();
const suffix = process.platform === 'win32' ? '.exe' : '';
const binary = resolve(
  process.env.DOWNLOADER_NATIVE_BINARY ?? 'target/debug/downloader-service' + suffix,
);
const testDirectory = resolve(process.env.DOWNLOADER_DATA_DIR ?? '.local/smoke');
async function cliJson(cli, args, env) {
  const child = spawn(cli, [...args, '--json'], { env, windowsHide: true });
  let output = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('CLI response timeout'));
    }, 15000);
    child.stdout.on('data', (bytes) => {
      output += bytes.toString();
      try {
        const value = JSON.parse(output);
        clearTimeout(timer);
        child.stdin.end();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        resolve(value);
      } catch {}
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code && !output) {
        clearTimeout(timer);
        reject(Error('CLI exited ' + code));
      }
    });
  });
}
export async function native(command, args, origin = 'chrome-extension://' + extensionId + '/') {
  const child = spawn(binary, [origin], {
    windowsHide: true,
    env: { ...process.env, DOWNLOADER_DATA_DIR: testDirectory },
  });
  const message = Buffer.from(
      JSON.stringify({
        version: 1,
        id: randomUUID(),
        command,
        ...(args ? { args } : {}),
      }),
    ),
    prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(message.length);
  let bytes = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('Native response timeout'));
    }, 15000);
    child.stdout.on('data', (data) => {
      bytes = Buffer.concat([bytes, data]);
      if (bytes.length >= 4 && bytes.length >= 4 + bytes.readUInt32LE()) {
        clearTimeout(timer);
        child.stdin.end();
        const response = JSON.parse(bytes.subarray(4, 4 + bytes.readUInt32LE()).toString());
        resolve(response);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!bytes.length) {
        clearTimeout(timer);
        reject(Error('Native host exited ' + code));
      }
    });
    child.stdin.write(Buffer.concat([prefix, message]));
  });
}
if (process.argv[2] === 'navigate') {
  console.log(
    JSON.stringify(
      await native('navigate', {
        request_id: randomUUID(),
        url: process.argv[3] ?? 'http://127.0.0.1:8129/hosted',
        filename: null,
        directory: null,
        queue: null,
        checksum: null,
        paused: true,
        context: { headers: {} },
        media: null,
        description: 'Hosted-page fixture',
      }),
      null,
      2,
    ),
  );
} else {
  const cli = join(dirname(binary), 'downloader' + suffix);
  const cliEnv = { ...process.env, DOWNLOADER_DATA_DIR: testDirectory };
  const unrelatedJob = await cliJson(
    cli,
    ['add', 'https://example.invalid/native-boundary-fixture', '--paused'],
    cliEnv,
  );
  const snap = await native('snapshot');
  if (!snap.ok || snap.data.settings || snap.data.jobs.some((j) => j.destination))
    throw Error('Native snapshot privacy boundary failed');
  const forbidden = await native('quit');
  if (forbidden.ok) throw Error('Privileged command was allowed');
  const unrelated = await native('cancel', {
    id: unrelatedJob.id,
  });
  if (unrelated.ok) throw Error('Native bridge controlled unrelated desktop job');
  let refused = false;
  try {
    await native('snapshot', undefined, 'chrome-extension://' + 'a'.repeat(32) + '/');
  } catch {
    refused = true;
  }
  if (!refused) throw Error('Unknown extension was allowed');
  await cliJson(cli, ['remove', unrelatedJob.id], cliEnv);
  await mkdir('.local/evidence', { recursive: true });
  await writeFile(
    '.local/evidence/native.json',
    JSON.stringify(
      {
        snapshotPrivacy: true,
        privilegedCommandsRefused: true,
        unrelatedJobsRefused: true,
        unknownOriginRefused: true,
      },
      null,
      2,
    ),
  );
  console.log('Native identity, command restrictions and snapshot privacy checks passed.');
}
