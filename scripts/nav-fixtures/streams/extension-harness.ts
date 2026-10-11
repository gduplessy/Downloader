import browser from 'webextension-polyfill';
import {
  NativeStreamPort,
  DurableStreamSink,
} from '../../../apps/extension/src/navigation/streams/transport';
import {
  armChromium,
  originalResponseMetadata,
} from '../../../apps/extension/src/navigation/streams/capture';
import { readOwnedBlob } from '../../../apps/extension/src/navigation/streams/blob';
import { scopeForTab } from '../../../apps/extension/src/navigation/session/scope';
const api = (globalThis as any).chrome;
(globalThis as any).fixtureDebug = [];
api.debugger.onEvent.addListener((source: any, method: string, params: any) => {
  if (method === 'Fetch.requestPaused')
    (globalThis as any).fixtureDebug.push({
      source,
      method,
      frameId: params.frameId,
      url: params.request?.url,
      status: params.responseStatusCode,
    });
});
const sinks = new Map<string, DurableStreamSink>();
const ownedScopes: any[] = [];
browser.runtime.onMessage.addListener((message: any, sender: any) => {
  if (message.type !== 'owned_blob_stream') return;
  const sink = sinks.get(message.capability);
  if (!sink || sender.tab?.id !== fixtureTab || sender.frameId !== 0)
    throw Error('Unexpected fixture sender');
  return (async () => {
    if (message.operation === 'chunk')
      await sink.chunk(Uint8Array.from(atob(message.data_base64), (c: string) => c.charCodeAt(0)));
    else if (message.operation === 'end') {
      await sink.end();
      sinks.delete(message.capability);
    } else throw Error('Blob reader failed');
    return true;
  })();
});
let fixtureTab: number;
(globalThis as any).runFixture = async function (
  base: string,
  host: string,
  payloadLength = 8 * 1024 * 1024 + 17,
) {
  const profile = crypto.randomUUID();
  const started = performance.now();
  const ackLatencies: number[] = [];
  const tab = await browser.tabs.create({ url: base, active: false });
  fixtureTab = tab.id!;
  while ((await browser.tabs.get(tab.id!)).status !== 'complete')
    await new Promise((r) => setTimeout(r, 50));
  (globalThis as any).fixtureStage = 'connecting-native';
  const bridge = browser.runtime.connectNative(host);
  const waiters = new Map<
    string,
    { resolve: (data: any) => void; reject: (error: Error) => void }
  >();
  bridge.onMessage.addListener((response: any) => {
    const waiter = waiters.get(response.id);
    waiters.delete(response.id);
    response.ok ? waiter?.resolve(response.data) : waiter?.reject(Error(response.error?.message));
  });
  bridge.onDisconnect.addListener(() => {
    for (const waiter of waiters.values())
      waiter.reject(Error('Native disconnected: ' + api.runtime.lastError?.message));
    waiters.clear();
  });
  function native(command: string, args: any) {
    (globalThis as any).fixtureStage = command;
    const id = crypto.randomUUID();
    const result = new Promise((resolve, reject) => waiters.set(id, { resolve, reject }));
    bridge.postMessage({ version: 1, id, command, args });
    return result;
  }
  async function makeSink(filename: string, deferred = false) {
    const job: any = await native('navigate', {
      request_id: crypto.randomUUID(),
      url: base,
      filename,
      paused: true,
      context: { profile, browser: 'chromium', private: false, headers: {} },
      description: '',
    });
    const scope = await scopeForTab(browser as any, 'chromium', profile, tab.id!, 1);
    const claim: any = await native('claim_navigation', {
      id: job.id,
      owner: profile,
      force: false,
      scope,
    });
    ownedScopes.push(claim.scope);
    const sink = new DurableStreamSink(
      {
        stream_id: crypto.randomUUID(),
        scope: claim.scope,
        source_generation: claim.source_generation,
      },
      new NativeStreamPort(() => {
        const port = browser.runtime.connectNative(host);
        const timestamps = new Map<string, number>();
        const post = port.postMessage.bind(port);
        (port as any).postMessage = (value: any) => {
          timestamps.set(value.id, performance.now());
          post(value);
        };
        port.onMessage.addListener((response: any) => {
          const started = timestamps.get(response.id);
          if (started !== undefined) {
            ackLatencies.push(performance.now() - started);
            timestamps.delete(response.id);
          }
        });
        return port;
      }),
      async () => {},
    );
    if (!deferred) await sink.begin({ kind: 'job', id: job.id }, filename, null);
    return { sink, job };
  }
  const post = await makeSink('original-post.bin', true);
  const postStarted = performance.now();
  let resolvePost: (value: any) => void, rejectPost: (error: any) => void;
  const postDone = new Promise((resolve, reject) => {
    resolvePost = resolve;
    rejectPost = reject;
  });
  (globalThis as any).fixtureStage = 'arming-post';
  await armChromium(
    api.debugger,
    tab.id!,
    { url: base + '/one-use', method: 'POST' },
    post.sink,
    async (state) => {
      (globalThis as any).fixtureStage = state;
      if (state === 'complete')
        resolvePost({
          bytes: post.sink.offset,
          peakBufferedBytes: post.sink.peakBufferedBytes,
          elapsedMs: performance.now() - postStarted,
        });
      if (['interrupted', 'detached'].includes(state)) rejectPost(Error('Capture ' + state));
    },
    async (headers) => {
      const metadata = originalResponseMetadata(headers);
      await post.sink.begin(
        { kind: 'job', id: post.job.id },
        metadata.filename ?? 'original-post.bin',
        metadata.total,
      );
    },
  );
  await browser.scripting.executeScript({
    target: { tabId: tab.id! },
    func: () => {
      (document.querySelector('form') as HTMLFormElement).submit();
    },
  });
  (globalThis as any).fixtureStage = 'waiting-post';
  const postResult = await postDone;
  const blob = await makeSink('original-blob.bin');
  const blobStarted = performance.now();
  const capability = crypto.randomUUID();
  sinks.set(capability, blob.sink);
  const [{ result: url }] = await browser.scripting.executeScript({
    target: { tabId: tab.id! },
    world: 'MAIN',
    args: [payloadLength],
    func: (payloadLength: number) => {
      const bytes = new Uint8Array(payloadLength);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 251;
      return URL.createObjectURL(new Blob([bytes]));
    },
  });
  await browser.scripting.executeScript({
    target: { tabId: tab.id! },
    func: readOwnedBlob,
    args: [url, capability, 196608],
  });
  const snapshot: any = await native('browser_snapshot', {
    owner: profile,
    private: false,
    scopes: ownedScopes,
  });
  bridge.disconnect();
  const elapsedMs = performance.now() - started;
  ackLatencies.sort((a, b) => a - b);
  return {
    elapsedMs,
    ack: {
      count: ackLatencies.length,
      meanMs: ackLatencies.reduce((a, b) => a + b, 0) / ackLatencies.length,
      p95Ms: ackLatencies[Math.floor(ackLatencies.length * 0.95)],
      maxMs: ackLatencies.at(-1),
    },
    post: postResult,
    blob: {
      bytes: blob.sink.offset,
      peakBufferedBytes: blob.sink.peakBufferedBytes,
      elapsedMs: performance.now() - blobStarted,
    },
    jobs: snapshot.jobs.map((job: any) => ({ id: job.id, state: job.state, bytes: job.bytes })),
  };
};
