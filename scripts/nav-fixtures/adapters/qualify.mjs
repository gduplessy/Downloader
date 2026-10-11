import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { startAdapterFixtureServer, providers, expectedHash, fixtureHtml } from './server.mjs';
const fixture = await startAdapterFixtureServer({ port: 0 });
try {
  for (const provider of providers) {
    for (const scenario of [
      'get',
      'post',
      'ambiguous',
      'ads',
      'localized',
      'shadow',
      'replaced',
      'wait',
      'unsafe',
      'login',
      'expired',
      'changed',
      'chosen',
      'submitter',
      'hidden',
      'script',
      'token',
      'closed',
    ])
      assert.match(fixtureHtml(provider, scenario), /Synthetic adapter fixture/);
    const file = await fetch(`${fixture.base}/nav-adapters/${provider}/file.bin?fixture=public`);
    assert.match(file.headers.get('content-disposition'), new RegExp(`${provider}-fixture.bin`));
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await file.arrayBuffer()))
        .digest('hex'),
      expectedHash,
    );
    const postUrl = `${fixture.base}/nav-adapters/${provider}/one-use.bin`;
    assert.equal((await fetch(postUrl)).status, 409);
    const post = await fetch(postUrl, { method: 'POST', body: 'token=fixture-public-one-use' });
    assert.equal(post.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await post.arrayBuffer()))
        .digest('hex'),
      expectedHash,
    );
    assert.equal(
      (await fetch(postUrl, { method: 'POST', body: 'token=fixture-public-one-use' })).status,
      409,
    );
    assert.equal((await fetch(`${fixture.base}/nav-adapters/${provider}/redirect`)).status, 200);
  }
  assert.equal(fixture.requests.length, 8);
  assert(
    fixture.requests.every(
      (request) => request.outcome === 'file' && request.sha256 === expectedHash,
    ),
  );
  console.log(
    JSON.stringify({
      fixture: 'synthetic-adapter-http-v1',
      fixture_pages: 4 * 18,
      outcome: 'passed',
      expected_sha256: expectedHash,
      verified_file_requests: fixture.requests.length,
    }),
  );
} finally {
  await fixture.close();
}
