import { readFile, writeFile, mkdir, rename, chmod, rm, copyFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, basename, dirname } from 'node:path';
import { unzipSync } from 'fflate';
import { execFileSync } from 'node:child_process';
const platforms = ['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64'];
const target = process.env.DOWNLOADER_COMPONENT_TARGET ?? process.platform + '-' + process.arch;
if (!platforms.includes(target)) throw Error('Unsupported component target: ' + target);
const lockFile = resolve('components.lock.json'),
  headers = {
    'User-Agent': 'Downloader-component-builder',
    Accept: 'application/vnd.github+json',
  };
const mode = process.argv[2] ?? 'status';
async function release(repo) {
  const response = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', {
    headers,
  });
  if (!response.ok) throw Error(repo + ': HTTP ' + response.status);
  return response.json();
}
async function metadata(repo, test, outputs, kind = 'zip') {
  const r = await release(repo),
    a = r.assets.find(test);
  if (!a) throw Error('No suitable asset for ' + repo + ' / ' + target);
  let digest = a.digest?.replace(/^sha256:/, '');
  if (!digest) {
    const sums = r.assets.find((x) =>
      /^(?:SHA2-256SUMS|SHA256SUMS|sha256sum\.txt|checksums\.txt)$/i.test(x.name),
    );
    if (sums) {
      const text = await (await fetch(sums.browser_download_url)).text();
      const line = text.split('\n').find((x) => x.trim().endsWith(a.name));
      digest = line?.trim().split(/\s+/)[0];
    }
  }
  if (!/^[a-f0-9]{64}$/i.test(digest ?? ''))
    throw Error('Upstream has no SHA-256 for ' + a.name + '; refusing an unverified component');
  return {
    repository: repo,
    version: r.tag_name,
    asset: a.name,
    url: a.browser_download_url,
    sha256: digest,
    outputs,
    kind,
    source: 'https://github.com/' + repo + '/tree/' + r.tag_name,
  };
}
if (mode === 'lock') {
  let lock;
  try {
    lock = JSON.parse(await readFile(lockFile, 'utf8'));
  } catch {
    lock = { version: 1, targets: {} };
  }
  const win = target.startsWith('win32'),
    mac = target.startsWith('darwin'),
    arm = target.endsWith('arm64'),
    suffix = win ? '.exe' : '';
  const ytdlp = await metadata(
    'yt-dlp/yt-dlp',
    (a) => a.name === (win ? 'yt-dlp.exe' : mac ? 'yt-dlp_macos' : 'yt-dlp_linux'),
    ['yt-dlp' + suffix],
    'file',
  );
  const deno = await metadata(
    'denoland/deno',
    (a) =>
      a.name ===
      'deno-' +
        (arm ? 'aarch64' : 'x86_64') +
        '-' +
        (win ? 'pc-windows-msvc' : mac ? 'apple-darwin' : 'unknown-linux-gnu') +
        '.zip',
    ['deno' + suffix],
  );
  const ffmpeg = await metadata(
    'yt-dlp/FFmpeg-Builds',
    (a) => a.name === 'ffmpeg-master-latest-' + (win ? 'win64-gpl.zip' : 'linux64-gpl.tar.xz'),
    ['ffmpeg' + suffix, 'ffprobe' + suffix],
    win ? 'zip' : 'tar',
  );
  if (mac)
    throw Error(
      'macOS FFmpeg source build recipe is required; do not ship Linux binaries as a macOS bundle',
    );
  lock.targets[target] = [ytdlp, ffmpeg, deno];
  await writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n');
  console.log('Locked ' + target + ' component checksums');
  process.exit(0);
}
if (mode === 'install') {
  const lock = JSON.parse(await readFile(lockFile, 'utf8')),
    entries = lock.targets[target];
  if (!entries) throw Error('No qualified component lock for ' + target);
  const destination = resolve(process.argv[3] ?? join('.components', target));
  await mkdir(dirname(destination), { recursive: true });
  const stage = await mkdtemp(destination + '.staging-');
  try {
    for (const entry of entries) {
      console.log('Downloading ' + entry.asset + ' (' + entry.version + ')');
      const response = await fetch(entry.url);
      if (!response.ok) throw Error('HTTP ' + response.status);
      const data = new Uint8Array(await response.arrayBuffer());
      if (createHash('sha256').update(data).digest('hex') !== entry.sha256)
        throw Error('SHA-256 mismatch for ' + entry.asset);
      if (entry.kind === 'file') await writeFile(join(stage, entry.outputs[0]), data);
      else if (entry.kind === 'zip') {
        const wanted = new Set(entry.outputs);
        const files = unzipSync(data, {
          filter: (file) => wanted.has(basename(file.name)),
        });
        for (const output of entry.outputs) {
          const found = Object.entries(files).find(([name]) => basename(name) === output);
          if (!found) throw Error('Archive is missing ' + output);
          await writeFile(join(stage, output), found[1]);
        }
      } else {
        const archive = join(stage, 'verified.tar.xz');
        await writeFile(archive, data);
        const names = execFileSync('tar', ['-tf', archive], {
          encoding: 'utf8',
        }).split(/\r?\n/);
        for (const output of entry.outputs) {
          const path = names.find((name) => basename(name) === output);
          if (!path || path.startsWith('/') || path.split('/').includes('..'))
            throw Error('Unsafe or missing archive member');
          await writeFile(
            join(stage, output),
            execFileSync('tar', ['-xOf', archive, path], {
              maxBuffer: 200 * 1024 * 1024,
            }),
          );
        }
        await rm(archive);
      }
      for (const output of entry.outputs) {
        await chmod(join(stage, output), 0o755);
      }
    }
    await writeFile(
      join(stage, 'component-manifest.json'),
      JSON.stringify({ target, entries }, null, 2),
    );
    // Retain the previous verified bundle for rollback. Never silently replace it.
    let existing = false;
    try {
      await readFile(join(destination, 'component-manifest.json'));
      existing = true;
    } catch {}
    if (existing) await rename(destination, destination + '.previous-' + Date.now());
    await rename(stage, destination);
    console.log('Installed verified components in ' + destination);
  } catch (error) {
    if (dirname(stage) !== dirname(destination) || !stage.startsWith(destination + '.staging-'))
      throw Error('Refusing cleanup outside the generated staging directory');
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
} else
  console.log(
    JSON.stringify(JSON.parse(await readFile(lockFile, 'utf8')).targets[target], null, 2),
  );
