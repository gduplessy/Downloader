// Observation-only opt-in live smoke. It does not sign in, click, solve challenges,
// or qualify a provider transfer. Use permitted public URLs and a local gstack browse binary.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const value = (name) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const page = value('--url');
if (!page) {
  console.log(
    'Usage: node scripts/nav-fixtures/adapters/live-smoke.mjs --url <permitted-page> --browse <gstack-browse-binary>\nObservation only; never part of normal CI. Live transfer/account acceptance remains pending.',
  );
  process.exit(0);
}
const url = new URL(page);
const allowed = new Set([
  'g4u.to',
  'ddownload.com',
  'www.ddownload.com',
  'rapidgator.net',
  'www.rapidgator.net',
  'gofile.io',
]);
if (url.protocol !== 'https:' || url.username || url.password || !allowed.has(url.hostname))
  throw Error('A permitted HTTPS provider page is required');
const binary = value('--browse') ?? process.env.GSTACK_BROWSE_BINARY;
if (!binary) throw Error('Supply the installed gstack browse binary');
const output = resolve('.local/nav-adapters/live');
await mkdir(output, { recursive: true });
const run = (args) => {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: 45000,
    windowsHide: true,
    env: { ...process.env, BROWSE_STATE_FILE: join(output, 'browse.json') },
  });
  if (result.status !== 0) throw Error('gstack observation failed; inspect browser locally');
  return result.stdout.trim();
};
run(['goto', url.href]);
const observed = run([
  'js',
  'JSON.stringify({host:location.hostname,titlePresent:!!document.title,login:!!document.querySelector("input[type=password]"),controls:document.querySelectorAll("a[href],button,input[type=submit]").length})',
]);
let status;
try {
  status = JSON.parse(observed);
} catch {
  throw Error('gstack returned an unexpected observation');
}
const record = {
  tested_at: new Date().toISOString(),
  evidence_class: 'live-observation',
  host: url.hostname,
  observation: status,
  outcome: 'pending',
  reason: 'Read-only observation does not qualify file/account workflows',
  recovery: 'Supply permitted recorded layout and end-to-end file hash evidence',
};
await writeFile(join(output, 'observation.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
