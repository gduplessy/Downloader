import { describe, expect, it } from 'vitest';
import { RetryAfterRequests, serverResponseWait, type ServerAuthority } from './retry-after';
import { observeWait, observeServerWait, retryAfter, WaitClock } from './waits';
const scope = {
  browser: 'chromium' as const,
  profile: 'owner',
  private: false,
  cookie_store_id: '0',
  container_id: null,
  partition_key: null,
  claim_generation: 3,
};
const authority: ServerAuthority = {
  id: 'job',
  tabId: 7,
  scope,
  sourceGeneration: 8,
  sessionEpoch: 'epoch',
};
const request = {
  requestId: 'r1',
  tabId: 7,
  frameId: 0,
  type: 'main_frame',
  url: 'https://fixture.test/wait',
  incognito: false,
};
const response = {
  ...request,
  documentId: 'document',
  statusCode: 429,
  responseHeaders: [{ name: 'Retry-After', value: '60' }],
};
const bound = { ...authority, documentId: 'document' };
describe('exact navigation Retry-After authority', () => {
  it('buffers headers behind pending owner lookup without losing their observed deadline', async () => {
    let now = 1000,
      resolve!: (value: ServerAuthority) => void;
    const owner = new Promise<ServerAuthority>((r) => {
      resolve = r;
    });
    const requests = new RetryAfterRequests(() => now);
    requests.begin(request, owner);
    const pending = requests.headers(response);
    now = 5000;
    resolve(authority);
    const observed = await pending;
    expect(observed?.deadline).toBe(61000);
    expect(serverResponseWait(observed!, bound, undefined, now)?.basis).toBe('server');
    expect(await requests.headers(response)).toBeNull();
  });
  it('refuses a late response after exact request replacement even when URLs match', async () => {
    let resolve!: (value: ServerAuthority) => void;
    const requests = new RetryAfterRequests(() => 1000);
    requests.begin(
      request,
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = requests.headers(response);
    requests.begin({ ...request, requestId: 'r2' }, Promise.resolve(authority));
    resolve(authority);
    expect(await pending).toBeNull();
    expect(await requests.headers(response)).toBeNull();
  });
  it.each([
    { tabId: 8 },
    { frameId: 1 },
    { type: 'xmlhttprequest' },
    { requestId: 'foreign' },
    { url: 'https://other.test/wait' },
    { incognito: true },
    { statusCode: 200 },
    { documentId: undefined },
    {
      responseHeaders: [
        { name: 'Retry-After', value: '5' },
        { name: 'Retry-After', value: '10' },
      ],
    },
  ])('rejects foreign or ambiguous response %j', async (patch) => {
    const requests = new RetryAfterRequests(() => 1000);
    requests.begin(request, Promise.resolve(authority));
    expect(await requests.headers({ ...response, ...patch })).toBeNull();
  });
  it('accepts qualified 503 dates and refuses reused tab IDs after removal', async () => {
    const requests = new RetryAfterRequests(() => 1000);
    requests.begin(request, Promise.resolve(authority));
    const date = new Date(61000).toUTCString();
    expect(
      (
        await requests.headers({
          ...response,
          statusCode: 503,
          responseHeaders: [{ name: 'retry-after', value: date }],
        })
      )?.deadline,
    ).toBe(61000);
    requests.removeTab(7);
    expect(await requests.headers(response)).toBeNull();
  });
  it('revalidates committed document/native scope/source/epoch and does not persist header or URL', async () => {
    const requests = new RetryAfterRequests(() => 1000);
    requests.begin(request, Promise.resolve(authority));
    const observed = (await requests.headers(response))!;
    for (const patch of [
      { id: 'foreign' },
      { tabId: 8 },
      { sourceGeneration: 9 },
      { sessionEpoch: 'replacement' },
      { documentId: 'replacement' },
      { scope: { ...scope, private: true } },
      { scope: { ...scope, claim_generation: 4 } },
    ]) {
      expect(serverResponseWait(observed, { ...bound, ...patch }, undefined, 1001)).toBeNull();
    }
    const wait = serverResponseWait(observed, bound, undefined, 1001)!;
    expect(JSON.stringify(wait)).not.toMatch(/https|Retry-After|document|owner/);
    expect(serverResponseWait(observed, bound, undefined, 122000)).toBeNull();
  });
});
describe('server deadlines', () => {
  it('cannot be replaced by a shorter DOM timer or duplicate header', () => {
    const wait = observeServerWait(undefined, 8, 61000, 1000);
    expect(observeWait(wait, 8, 1000, 5000, 'page')).toBe(wait);
    expect(observeServerWait(wait, 8, 65000, 5000)).toBe(wait);
    expect(observeWait(wait, 9, 1000, 5000, 'page').basis).toBe('page');
  });
  it('uses monotonic deadline through clock jumps, then restart UTC for a fresh observation only', () => {
    let utc = 1000,
      mono = 0;
    const wait = observeServerWait(undefined, 8, 61000, utc);
    const clock = new WaitClock({ utc: () => utc, monotonic: () => mono });
    expect(clock.remaining('wait', wait)).toBe(60000);
    utc += 999999;
    mono = 1000;
    expect(clock.remaining('wait', wait)).toBe(59000);
    utc = -5000;
    mono = 60000;
    expect(clock.remaining('wait', wait)).toBe(0);
    expect(new WaitClock({ utc: () => 31000, monotonic: () => 0 }).remaining('wait', wait)).toBe(
      30000,
    );
  });
  it.each([
    '-1',
    '1.5',
    '1e3',
    '99999999999999999',
    '999999',
    'not a date',
    'a'.repeat(129),
    '1\r\nsecret',
    'Thu, 32 Jan 1970 00:00:00 GMT',
  ])('rejects malformed/oversized header %s', (value) => {
    expect(retryAfter(value, 1000)).toBeNull();
  });
});
