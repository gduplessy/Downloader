import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRetryDate, startRetryAfterServer } from './retry-after-server.mjs';
const sample = Date.UTC(1994, 10, 6, 8, 49, 37);
for (const [format, expected] of [
  ['imf', 'Sun, 06 Nov 1994 08:49:37 GMT'],
  ['rfc850', 'Sunday, 06-Nov-94 08:49:37 GMT'],
  ['asctime', 'Sun Nov  6 08:49:37 1994'],
]) {
  test('fixture emits exact ' + format + ' grammar and independent server deadline', async () => {
    assert.equal(formatRetryDate(sample, format), expected);
    const server = await startRetryAfterServer({ dateFormat: format });
    try {
      const response = await fetch(server.base + '/nav-adapters/gofile/limited?case=date');
      assert.equal(response.status, 503);
      const row = server.cases.get('date');
      assert.equal(response.headers.get('retry-after'), formatRetryDate(row.readyAt, format));
      assert.ok(row.readyAt > Date.now() + 9000);
      assert.match(await response.text(), /setTimeout\(ready,1000\)/);
      assert.equal(server.requests.length, 1);
    } finally {
      await server.close();
    }
  });
}
test('fixture defaults to IMF and rejects unsupported format', async () => {
  assert.equal(formatRetryDate(sample), 'Sun, 06 Nov 1994 08:49:37 GMT');
  await assert.rejects(startRetryAfterServer({ dateFormat: 'unknown' }));
});
