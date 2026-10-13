import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startAccountFixtureServer, providers, expectedHash } from './server.mjs';
const fixture = await startAccountFixtureServer({ port: 0 });
try {
  for (const provider of providers) {
    const base = fixture.base + '/nav-adapters/' + provider;
    assert.equal((await fetch(base + '/premium.bin')).status, 401);
    const wrong = await fetch(base + '/login', {
      method: 'POST',
      body: 'username=alice&password=wrong',
      redirect: 'manual',
    });
    assert.match(await wrong.text(), /data-nav-account-state="rejected"/);
    const login = await fetch(base + '/login', {
      method: 'POST',
      body: 'username=alice&password=fixture-only',
      redirect: 'manual',
    });
    assert.equal(login.status, 303);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    for (const scenario of [
      'account',
      'expired-entitlement',
      'quota',
      'unknown',
      'mfa',
      'foreign-action',
      'hidden',
    ])
      assert.equal(
        (await fetch(base + '/' + scenario, { headers: { Cookie: cookie } })).status,
        200,
      );
    const file = await fetch(base + '/premium.bin', { headers: { Cookie: cookie } });
    assert.equal(file.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await file.arrayBuffer()))
        .digest('hex'),
      expectedHash,
    );
    await fetch(base + '/logout', { headers: { Cookie: cookie } });
    assert.equal((await fetch(base + '/premium.bin', { headers: { Cookie: cookie } })).status, 401);
  }
  assert.equal(fixture.counts.purchase, 0);
  console.log(
    JSON.stringify({
      fixture: 'nav-account-http-v1',
      providers,
      assertions: 52,
      verified_files: fixture.counts.file,
      expected_sha256: expectedHash,
      outcome: 'passed',
      qualification: 'HTTP fixture contracts only; not installed extension acceptance',
    }),
  );
} finally {
  await fixture.close();
}
