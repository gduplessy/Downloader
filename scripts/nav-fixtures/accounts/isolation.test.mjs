import assert from 'node:assert/strict';
import { startAccountFixtureServer } from './server.mjs';
const payloads = {
  alice: Buffer.from('permitted Alice file'),
  bob: Buffer.from('permitted Bob file'),
};
const fixture = await startAccountFixtureServer({ port: 0, accountPayloads: payloads });
try {
  const cookies = {};
  for (const name of ['alice', 'bob']) {
    const result = await fetch(fixture.base + '/nav-adapters/ddownload/login', {
      method: 'POST',
      redirect: 'manual',
      body: new URLSearchParams({ username: name, password: 'fixture-only' }),
    });
    assert.equal(result.status, 303);
    cookies[name] = result.headers.get('set-cookie').split(';')[0];
  }
  assert.notEqual(cookies.alice, cookies.bob);
  for (const name of ['alice', 'bob']) {
    const result = await fetch(fixture.base + '/nav-adapters/ddownload/premium.bin', {
      headers: { Cookie: cookies[name] },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), payloads[name]);
  }
  assert.deepEqual(
    fixture.requests.filter((r) => r.path.endsWith('/premium.bin')).map((r) => r.account),
    ['alice', 'bob'],
  );
  assert.ok(
    !JSON.stringify(fixture.requests).includes('fixture-session-'),
    'Audit must not retain session tokens',
  );
  console.log('PASS distinct account payloads and secret-free request audit (HTTP contracts only)');
} finally {
  await fixture.close();
}
