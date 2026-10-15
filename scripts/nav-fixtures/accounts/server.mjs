import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export const payload = Buffer.from('NAV account permitted fixture file v1\n'.repeat(8192));
export const expectedHash = createHash('sha256').update(payload).digest('hex');
export const providers = ['g4u', 'ddownload', 'rapidgator', 'gofile'];
const html = (body) =>
  '<!doctype html><meta charset="utf-8"><title>NAV scoped account fixture</title><style>body{font:16px system-ui;margin:40px}input,button,a{display:block;padding:12px;margin:8px}label{display:block}</style><h1>Permitted synthetic account fixture</h1>' +
  body +
  '<script src="/account-harness.js"></script>';
export function page(provider, scenario, { account = 'alice', authenticated = false } = {}) {
  const base = '/nav-adapters/' + provider;
  const status =
    scenario === 'mfa'
      ? 'mfa_required'
      : scenario === 'rejected'
        ? 'rejected'
        : scenario === 'logout'
          ? 'signed_out'
          : scenario === 'expired-cookie'
            ? 'expired'
            : authenticated
              ? 'authenticated'
              : 'signed_out';
  const entitlement =
    scenario === 'expired-entitlement'
      ? 'expired'
      : scenario === 'quota'
        ? 'quota_exhausted'
        : scenario === 'unknown'
          ? 'unknown'
          : 'active';
  const marker =
    '<p data-nav-account-state="' +
    status +
    '" data-nav-account-id="' +
    (authenticated ? account : '') +
    '" data-nav-entitlement="' +
    (authenticated ? entitlement : 'unknown') +
    '">' +
    status +
    '</p>';
  const form =
    '<form id="login" data-nav-login="1" method="POST" action="' +
    base +
    '/login"><label>Username<input name="username" autocomplete="username"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form>';
  if (scenario === 'hidden') return html(marker + '<div hidden>' + form + '</div>');
  if (scenario === 'foreign-action')
    return html(
      marker + form.replace('action="' + base + '/login"', 'action="http://localhost:18784/login"'),
    );
  if (scenario === 'mfa')
    return html(
      marker +
        '<label>Complete MFA manually<input name="otp"></label><button type="button">Continue</button>',
    );
  if (status === 'authenticated')
    return html(
      marker +
        '<section data-download-host="ddownload.com"><a data-nav-fixture-control data-nav-premium-control download href="' +
        base +
        '/premium.bin">Premium download</a></section><a href="' +
        base +
        '/purchase">Buy premium</a><div data-ad><a data-nav-fixture-control data-nav-premium-control href="' +
        base +
        '/trap.bin">Premium download</a></div>',
    );
  return html(marker + form);
}
export async function startAccountFixtureServer({
  port = 18783,
  harness = '.local/nav-accounts/account-harness.js',
  accountPayloads = {},
  pageOwnedBlob = false,
} = {}) {
  const counts = { login: 0, file: 0, purchase: 0 };
  const sessions = new Map();
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const [, prefix, provider, scenario] = url.pathname.split('/');
    if (url.pathname === '/account-harness.js') {
      try {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(await readFile(harness));
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    if (prefix !== 'nav-adapters' || !providers.includes(provider)) {
      res.writeHead(404).end();
      return;
    }
    const cookie = (req.headers.cookie ?? '').match(/(?:^|; )nav_account=([^;]+)/)?.[1];
    const session = sessions.get(cookie);
    requests.push({ method: req.method, path: url.pathname, account: session?.account ?? null });
    if (scenario === 'login' && req.method === 'POST') {
      counts.login++;
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) {
          res.writeHead(413).end();
          return;
        }
      }
      const data = new URLSearchParams(body);
      if (
        data.get('password') !== 'fixture-only' ||
        !['alice', 'bob'].includes(data.get('username'))
      ) {
        res.setHeader('Content-Type', 'text/html');
        res.end(page(provider, 'rejected'));
        return;
      }
      const token = 'fixture-session-' + sessions.size;
      sessions.set(token, { account: data.get('username') });
      res
        .writeHead(303, {
          'Set-Cookie': 'nav_account=' + token + '; HttpOnly; SameSite=Strict; Path=/',
          Location: '/nav-adapters/' + provider + '/account',
        })
        .end();
      return;
    }
    if (scenario === 'logout') {
      if (cookie) sessions.delete(cookie);
      res.setHeader('Set-Cookie', 'nav_account=; Max-Age=0; Path=/');
    }
    if (scenario === 'premium.bin') {
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'text/html' }).end(page(provider, 'expired-cookie'));
        return;
      }
      counts.file++;
      const filePayload = accountPayloads[session.account] ?? payload;
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="account-fixture.bin"',
        'Content-Length': filePayload.length,
      });
      res.end(filePayload);
      return;
    }
    if (scenario === 'purchase' || scenario === 'trap.bin') {
      counts.purchase++;
      res.writeHead(403).end('Purchase/ad path is never permitted');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    let document = page(provider, scenario, {
      account: session?.account,
      authenticated: !!session,
    });
    if (
      pageOwnedBlob &&
      session &&
      ['account', 'expired-entitlement', 'quota', 'unknown'].includes(scenario)
    ) {
      document = document.replace(
        'data-nav-fixture-control data-nav-premium-control download href="',
        'id="premium-download" download href="',
      );
      document += `<button id="prepare-download" type="button">Prepare permitted download</button><script>(()=>{const link=document.getElementById('premium-download');const url=link.href;link.removeAttribute('href');document.getElementById('prepare-download').addEventListener('click',async()=>{const response=await fetch(url);if(!response.ok)throw Error('Fixture file refused');const blob=await response.blob();link.href=URL.createObjectURL(blob);link.setAttribute('data-nav-fixture-control','');link.setAttribute('data-nav-premium-control','');document.documentElement.dataset.fixtureBlobReady='true'},{once:true})})()</script>`;
    }
    res.end(document);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    base: 'http://127.0.0.1:' + server.address().port,
    counts,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
if (process.argv[1]?.endsWith('server.mjs')) {
  const fixture = await startAccountFixtureServer();
  console.log(fixture.base);
}
