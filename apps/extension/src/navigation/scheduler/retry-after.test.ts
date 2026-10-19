import { describe, expect, it } from 'vitest';
import {
  RetryAfterRequests,
  serverResponseWait,
  enqueueServerResponseWrite,
  type ServerAuthority,
} from './retry-after';
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
const commit = { tabId: 7, frameId: 0, documentId: 'document', url: request.url, timeStamp: 1000 };
function begin(
  requests: RetryAfterRequests,
  owner = Promise.resolve<ServerAuthority | null>(authority),
) {
  requests.begin(request, owner);
  void requests.committed(commit);
}
describe('exact navigation Retry-After authority', () => {
  it('retains first-request header authority through duplicate browser delivery', async () => {
    const requests = new RetryAfterRequests(() => 1000);
    const initial = { ...request, timeStamp: 1000 };
    requests.begin(initial, Promise.resolve(null));
    await requests.headers(response);
    requests.begin({ ...initial }, Promise.resolve(null));
    await requests.committed(commit);
    const candidate = await requests.adoptInitial(authority, {
      id: authority.id,
      sourceGeneration: authority.sourceGeneration,
      url: request.url,
      createdAt: 999,
    });
    expect(candidate?.deadline).toBe(61000);
    expect(
      await requests.adoptInitial(authority, {
        id: authority.id,
        sourceGeneration: authority.sourceGeneration,
        url: request.url,
        createdAt: 999,
      }),
    ).toBeNull();
  });

  it('buffers headers behind pending owner lookup without losing their observed deadline', async () => {
    let now = 1000,
      resolve!: (value: ServerAuthority) => void;
    const owner = new Promise<ServerAuthority>((r) => {
      resolve = r;
    });
    const requests = new RetryAfterRequests(() => now);
    begin(requests, owner);
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
    begin(
      requests,
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
    {
      responseHeaders: [
        { name: 'Retry-After', value: '5' },
        { name: 'Retry-After', value: '10' },
      ],
    },
  ])('rejects foreign or ambiguous response %j', async (patch) => {
    const requests = new RetryAfterRequests(() => 1000);
    begin(requests);
    expect(await requests.headers({ ...response, ...patch })).toBeNull();
  });
  it('accepts qualified 503 dates and refuses reused tab IDs after removal', async () => {
    const requests = new RetryAfterRequests(() => 1000);
    begin(requests);
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
    begin(requests);
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

it('bridges absent header documentId only through the exact committed lifecycle', async () => {
  const requests = new RetryAfterRequests(() => 1000);
  requests.begin(request, Promise.resolve(authority));
  expect(await requests.headers({ ...response, documentId: undefined })).toBeNull();
  expect(await requests.committed({ ...commit, frameId: 1 })).toBeNull();
  expect(await requests.committed({ ...commit, timeStamp: 999 })).toBeNull();
  const observed = await requests.committed(commit);
  expect(observed?.documentId).toBe('document');
  expect(await requests.committed(commit)).toBeNull();
});
it('later browser navigation intent fences a response even without a replacement request', async () => {
  const requests = new RetryAfterRequests(() => 1000);
  requests.begin({ ...request, timeStamp: 1000 }, Promise.resolve(authority));
  await requests.headers({ ...response, documentId: undefined });
  requests.navigating(7, 1001);
  expect(await requests.committed({ ...commit, timeStamp: 1002 })).toBeNull();
});
it('adopts only a newly created tab first request after exact original source/native claiming', async () => {
  const requests = new RetryAfterRequests(() => 1000);
  requests.begin(request, Promise.resolve(null));
  await requests.headers({ ...response, documentId: undefined });
  await requests.committed(commit);
  const intent = { id: 'job', sourceGeneration: 8, url: request.url, createdAt: 999 };
  expect(await requests.adoptInitial(authority, { ...intent, createdAt: 1001 })).toBeNull();
  expect(await requests.adoptInitial(authority, { ...intent, sourceGeneration: 9 })).toBeNull();
  expect((await requests.adoptInitial(authority, intent))?.deadline).toBe(61000);
  expect(await requests.adoptInitial(authority, intent)).toBeNull();
  const replaced = new RetryAfterRequests(() => 1000);
  replaced.begin(request, Promise.resolve(null));
  replaced.begin({ ...request, requestId: 'second' }, Promise.resolve(null));
  await replaced.headers({ ...response, requestId: 'second' });
  await replaced.committed(commit);
  expect(await replaced.adoptInitial(authority, intent)).toBeNull();
});

it('a distinct bound response extends, never shortens, a server deadline including an elapsed wait', () => {
  const first = observeServerWait(undefined, 8, 61000, 1000, 'first');
  expect(observeServerWait(first, 8, 65000, 5000, 'first')).toBe(first);
  expect(observeServerWait(first, 8, 60000, 2000, 'shorter')).toBe(first);
  const extended = observeServerWait(first, 8, 125000, 5000, 'second');
  expect(extended.deadline_ms).toBe(125000);
  expect(extended.generation).toBe(first.generation + 1);
  const afterElapsed = observeServerWait(first, 8, 132000, 72000, 'third');
  expect(afterElapsed.deadline_ms).toBe(132000);
  expect(afterElapsed.observed_duration_ms).toBe(60000);
});

it('serializes cancellation after a pending storage write without erasing a fresh subsequent response', async () => {
  const writes = new Map<number, Promise<void>>(),
    order: string[] = [];
  let release!: () => void, stored: string | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const old = enqueueServerResponseWrite(writes, 7, async () => {
    await blocked;
    stored = 'old';
    order.push('old');
  });
  const cancelled = enqueueServerResponseWrite(writes, 7, async () => {
    stored = undefined;
    order.push('clear');
  });
  const fresh = enqueueServerResponseWrite(writes, 7, async () => {
    stored = 'fresh';
    order.push('fresh');
  });
  await Promise.resolve();
  expect(order).toEqual([]);
  release();
  await Promise.all([old, cancelled, fresh]);
  expect(order).toEqual(['old', 'clear', 'fresh']);
  expect(stored).toBe('fresh');
});

it.each(['Sunday, 06-Nov-94 08:49:37 GMT', 'Sun Nov  6 08:49:37 1994'])(
  'ingests obsolete HTTP-date only through the existing exact request/document authority: %s',
  async value => {
    const deadline = Date.UTC(1994,10,6,8,49,37), now=deadline-12000;
    const requests = new RetryAfterRequests(()=>now);
    requests.begin({...request,timeStamp:now},Promise.resolve(authority));
    await requests.committed({...commit,timeStamp:now});
    const observed=await requests.headers({...response,responseHeaders:[{name:'Retry-After',value}]});
    expect(observed?.deadline).toBe(deadline);
    const wait=serverResponseWait(observed!,bound,undefined,now);
    expect(wait).toMatchObject({basis:'server',deadline_ms:deadline,observed_duration_ms:12000});
    expect(await requests.headers({...response,responseHeaders:[{name:'Retry-After',value}]})).toBeNull();
    expect(serverResponseWait(observed!,{...bound,documentId:'replacement'},undefined,now)).toBeNull();
  },
);
