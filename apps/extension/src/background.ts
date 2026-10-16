import { NavigationSources, NavigationSourceError } from './navigation/session/source';
import { RenderedDiscovery } from './navigation/discovery/runtime';
import {
  hasLiveResolver,
  verifyLiveDocument,
  type DocumentClaim,
} from './navigation/session/document';
import { NavigationStarts } from './navigation/session/start';
import { NavigationTransfer } from './navigation/session/transfer';
import { PremiumAuthorizations } from './navigation/accounts/premium';
import { accountRequest, validateAccountRequest } from './navigation/accounts/worker';
import { validateAccountDocument } from './navigation/accounts/document';
import { accountDecision } from './navigation/accounts/policy';
import type { AccountAction, AccountBinding, Selection } from './navigation/accounts/types';
import { ProjectionCursor, type ProjectionTicket } from './navigation/session/projection';
import {
  NavigationAuthorizations,
  type NavigationAuthorizationBinding,
} from './navigation/authorization';
import { matchAdapter } from './navigation/adapters/policy';
import type { SessionScope, StreamIdentity } from '../../../packages/shared/src/navigation';
import { scopeForTab, sameScope, sessionKey, type ScopedRequest } from './navigation/session/scope';
import { admittedNavigationJob } from './navigation/session/preflight';
import { navigationStorage, memoryStorage } from './navigation/session/store';
import { classifyReplay } from './navigation/streams/replay';
import { DurableStreamSink, NativeStreamPort } from './navigation/streams/transport';
import { DirectCaptureOwners } from './navigation/streams/ownership';
import { orphanedStreamIdentity, recoverStreamAbort } from './navigation/streams/recovery';
import { CaptureTransitions, interruptedCaptureMatches } from './navigation/streams/transitions';
import { armChromium, takeFirefox, originalResponseMetadata } from './navigation/streams/capture';
import { readOwnedBlob } from './navigation/streams/blob';
import { applyEvents } from '../../../packages/shared/src/events';
import browser from 'webextension-polyfill';
import { challengeHandler } from './navigation/challenges/worker';
import { shouldSolve } from './resolver-policy';
import { NavigationScheduler, WAIT_ALARM_PREFIX } from './navigation/scheduler/runtime';
import { cancelNavigationTask } from './navigation/scheduler/cancel';
import { observeWait, waitFingerprint, type DurableWait } from './navigation/scheduler/waits';
import {
  RetryAfterRequests,
  enqueueServerResponseWrite,
  serverResponseWait,
  type ServerAuthority,
  type ServerResponse,
} from './navigation/scheduler/retry-after';
import {
  defaults,
  eligible,
  handoff,
  excluded,
  sitePattern,
  type CaptureSettings,
  type Download,
} from './capture';
import { translate, type Key } from '../../../packages/shared/src/i18n';
declare const BROWSER: string;
const HOST = 'org.downloader.native';
const scheduler = new NavigationScheduler(
  (request) => native('navigation_scheduler', { request, private_lane: privateWorker }),
  async (id) => {
    const storage = await navigationStore.get('resolver-' + id);
    const record = storage['resolver-' + id] as ResolverRecord | undefined;
    if (record && (await ownsCurrentTab(record))) {
      await scheduler.heartbeat(id, record.tabId);
      await browser.tabs
        .sendMessage(record.tabId, { type: 'resolver_continue' })
        .catch(() => injectResolver(record.tabId));
    }
  },
);
let schedulerRecovered = false;
const resolverSteps = new Map<number, Promise<unknown>>();
const navigationAuthorizations = new NavigationAuthorizations();
const premiumAuthorizations = new PremiumAuthorizations();
const subscriptionCursor = new ProjectionCursor();
const committedAuthorizations = new Map<string, number>();

const privateWorker = Boolean(browser.extension.inIncognitoContext);
const ephemeralStore = browser.storage.session ?? memoryStorage();
const navigationStore = navigationStorage(browser.storage.local, ephemeralStore, privateWorker);
const browserEpoch = ephemeralStore.get('navigation-session-epoch').then(async (stored) => {
  const epoch =
    typeof stored['navigation-session-epoch'] === 'string'
      ? stored['navigation-session-epoch']
      : crypto.randomUUID();
  await ephemeralStore.set({ 'navigation-session-epoch': epoch });
  return epoch;
});
async function ownsCurrentTab(record: ResolverRecord): Promise<boolean> {
  if (!record.scope || record.sessionEpoch !== (await browserEpoch)) return false;
  try {
    const tab = await browser.tabs.get(record.tabId);
    if (!tab.url || (record.lastOrigin && new URL(tab.url).origin !== record.lastOrigin))
      return false;
    const actual = await scopeForTab(
      browser as any,
      BROWSER,
      await profile,
      record.tabId,
      record.scope.claim_generation,
    );
    return sameScope(actual, record.scope);
  } catch {
    return false;
  }
}
async function renewAuthority(key: string, record: ResolverRecord) {
  if (!record.scope || record.sessionEpoch !== (await browserEpoch)) return;
  const authority = await native('navigation_authority', {
    id: key.slice(9),
    owner: await profile,
    scope: record.scope,
  });
  if (
    authority.source_generation !== record.sourceGeneration ||
    authority.scope.claim_generation !== record.scope.claim_generation
  ) {
    navigationAuthorizations.invalidateTab(record.tabId);
    premiumAuthorizations.invalidateTab(record.tabId);
    // Renewal can run inside a queued response's native snapshot; enqueue without awaiting itself.
    void clearServerResponse(record.tabId).catch(() => {});
    delete record.serverWaitDocumentId;
    await captureCancels.get(record.tabId)?.();
    captureCancels.delete(record.tabId);
    record.scope = authority.scope;
    record.sourceGeneration = authority.source_generation;
    record.generation = authority.source_generation;
    delete record.wait;
    delete record.waitStarted;
    delete record.fingerprint;
    delete record.request;
    await navigationStore.set({ [key]: record });
  }
}
async function projectionScope() {
  const owner = await profile;
  const records = await navigationStore.get(null);
  const scopes: SessionScope[] = await discovery.liveScopes();
  for (const [key, value] of Object.entries(records)) {
    const record = value as ResolverRecord;
    if (!key.startsWith('resolver-') || !record.scope || record.scope.private !== privateWorker)
      continue;
    if (!privateWorker && record.sessionEpoch !== (await browserEpoch)) {
      scopes.push(record.scope);
      continue;
    }
    try {
      const actual = await scopeForTab(
        browser as any,
        BROWSER,
        owner,
        record.tabId,
        record.scope.claim_generation,
      );
      if (sameScope(actual, record.scope)) {
        await renewAuthority(key, record);
        scopes.push(record.scope!);
      }
    } catch {}
  }
  return { owner, private: privateWorker, scopes };
}
const profile = browser.storage.local.get('profileId').then(async (stored) => {
  const id = typeof stored.profileId === 'string' ? stored.profileId : crypto.randomUUID();
  if (!stored.profileId) await browser.storage.local.set({ profileId: id });
  return id;
});
const navigationSources = new NavigationSources(
  browser as any,
  BROWSER,
  profile,
  browserEpoch,
  ephemeralStore,
  privateWorker ? navigationStore : browser.storage.local,
  privateWorker,
);
const navigationTransfer = new NavigationTransfer(
  browser,
  BROWSER,
  profile,
  privateWorker,
  (args) => native('browser_navigation_transfer', args),
  navigationPermissions,
  async (accepted, tabId, page) => {
    await navigationStore.set({
      ['resolver-' + accepted.id]: {
        tabId,
        scope: accepted.scope,
        sourceGeneration: accepted.source_generation,
        generation: accepted.source_generation,
        sessionEpoch: await browserEpoch,
        started: Date.now(),
        steps: 0,
        lastOrigin: new URL(page).origin,
        private: accepted.scope.private,
      } satisfies ResolverRecord,
    });
    await native('browser_status', {
      id: accepted.id,
      state: 'waiting_browser',
      message: 'Session transfer accepted; revalidating this page.',
      bytes: 0,
      total: null,
      url: page,
    });
    eventSnapshot = null;
    const job = (await native('snapshot')).jobs.find((job: any) => job.id === accepted.id);
    if (!job) throw Error('Accepted task is unavailable in this session');
    await navigationSources.adopted(job);
    await scheduler.request({ action: 'control', id: job.id, paused: false, priority: null });
    await startResolver(job);
  },
);
const discovery = new RenderedDiscovery(
  native,
  () => profile,
  privateWorker,
  () => browserEpoch,
  async (id, sourceTabId) => {
    const snapshot = await native('snapshot');
    const job = snapshot.jobs.find((job: any) => job.id === id);
    if (!job) return false;
    await startResolver(job, true, sourceTabId);
    const row = (await navigationStore.get('resolver-' + id))['resolver-' + id] as
      ResolverRecord | undefined;
    return !!row && (await ownsCurrentTab(row));
  },
);
const requests = new Map<string, ScopedRequest>();
function requestFor(url: string, privateSession?: boolean) {
  const values = [...requests.values()].filter(
    (r) =>
      r.url === url &&
      (privateSession === undefined || r.scope.private === privateSession) &&
      Date.now() - r.time < 120000,
  );
  return values.length === 1 ? values[0] : undefined;
}
const captureCancels = new Map<number, (alreadySerialized?: boolean) => Promise<void>>();
const directOwners = new DirectCaptureOwners();
const captureTransitions = new CaptureTransitions();
const serverRequests = new RetryAfterRequests();
const serverHeaderWrites = new Map<number, Promise<void>>();
let serverNavigationInstalled = false;
function trackServerResponse(tabId: number, response: Promise<ServerResponse | null>) {
  // Compute event identity immediately; serialize persistence so a later commit cannot overtake a header write.
  void enqueueServerResponseWrite(serverHeaderWrites, tabId, async () => {
    const candidate = await response;
    if (!candidate || !serverRequests.current(candidate)) return;
    const current = await serverRequestAuthority(tabId);
    if (
      current &&
      candidate.id === current.id &&
      candidate.sourceGeneration === current.sourceGeneration &&
      candidate.sessionEpoch === current.sessionEpoch &&
      sameScope(candidate.scope, current.scope)
    )
      await navigationStore.set({ ['server-response-' + tabId]: candidate });
  }).catch(() => {});
}
function clearServerResponse(tabId: number): Promise<void> {
  serverRequests.removeTab(tabId);
  return enqueueServerResponseWrite(serverHeaderWrites, tabId, () =>
    navigationStore.remove('server-response-' + tabId),
  );
}

async function serverNavigationObservers() {
  if (
    BROWSER !== 'chromium' ||
    serverNavigationInstalled ||
    !(await browser.permissions.contains({ permissions: ['webNavigation'] }))
  )
    return;
  if (serverNavigationInstalled) return;
  serverNavigationInstalled = true;
  browser.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) serverRequests.navigating(details.tabId, details.timeStamp);
  });
  browser.webNavigation.onCommitted.addListener((details: any) => {
    if (details.frameId === 0)
      trackServerResponse(details.tabId, serverRequests.committed(details));
  });
}
async function serverRequestAuthority(tabId: number): Promise<ServerAuthority | null> {
  const records = await navigationStore.get(null);
  const entry = Object.entries(records).find(
    ([key, value]) => key.startsWith('resolver-') && value.tabId === tabId,
  );
  if (!entry) return null;
  const record = entry[1] as ResolverRecord;
  const job = (await native('snapshot')).jobs.find((job: any) => job.id === entry[0].slice(9));
  if (
    !record.scope ||
    !record.sourceGeneration ||
    record.scope.private !== privateWorker ||
    record.sessionEpoch !== (await browserEpoch) ||
    !job ||
    !sameScope(job.navigation_scope, record.scope) ||
    job.source_generation !== record.sourceGeneration ||
    !['waiting_browser', 'waiting_user'].includes(job.state) ||
    !(await ownsCurrentTab(record))
  )
    return null;
  return {
    id: job.id,
    tabId,
    scope: record.scope,
    sourceGeneration: record.sourceGeneration,
    sessionEpoch: record.sessionEpoch!,
  };
}
async function applyServerWait(id: string, record: ResolverRecord, documentId?: string) {
  if (!record.scope || !record.sourceGeneration || !record.documentNonce || !documentId) return;
  const authority = await serverRequestAuthority(record.tabId);
  if (
    !authority ||
    authority.id !== id ||
    authority.sourceGeneration !== record.sourceGeneration ||
    !sameScope(authority.scope, record.scope)
  )
    return;
  const live = await verifyLiveDocument(
    browser,
    BROWSER,
    record.tabId,
    { nonce: record.documentNonce, generation: record.documentGeneration! },
    documentId,
  );
  if (!live || live.documentId !== documentId) return;
  let changed = false;
  const key = 'server-response-' + record.tabId;
  const candidate = (await navigationStore.get(key))[key] as ServerResponse | undefined;
  if (candidate) {
    const wait = serverResponseWait(
      candidate,
      { ...authority, documentId },
      record.wait,
      Date.now(),
    );
    await navigationStore.remove(key);
    if (wait) {
      record.wait = wait;
      record.serverWaitDocumentId = documentId;
      record.waitStarted ??= wait.observed_at_ms;
      changed = true;
    }
  }
  if (!changed && record.wait?.basis === 'server' && record.serverWaitDocumentId !== documentId) {
    record.wait = observeWait(
      { ...record.wait, basis: 'page' },
      record.sourceGeneration,
      0,
      Date.now(),
      'document_replaced',
    );
    delete record.serverWaitDocumentId;
    changed = true;
  }
  if (changed && record.wait) {
    navigationAuthorizations.invalidateTab(record.tabId);
    premiumAuthorizations.invalidateTab(record.tabId);
    await scheduler.wait(id, record.wait);
    await navigationStore.set({ ['resolver-' + id]: record });
  }
}
const blobReaders = new Map<
  string,
  {
    tabId: number;
    frameId: number;
    scope: SessionScope;
    sink: DurableStreamSink;
    jobId: string;
    sourceGeneration: number;
    captureState: (state: string) => Promise<void>;
  }
>();
async function verifyStreamOwner(
  id: string,
  tabId: number,
  scope: SessionScope,
  generation: number,
) {
  const records = await navigationStore.get('resolver-' + id);
  const record = records['resolver-' + id] as ResolverRecord | undefined;
  const current = await scopeForTab(
    browser as any,
    BROWSER,
    await profile,
    tabId,
    scope.claim_generation,
  );
  if (
    record?.sessionEpoch !== (await browserEpoch) ||
    !record?.scope ||
    !sameScope(scope, current) ||
    !sameScope(scope, record.scope) ||
    record.sourceGeneration !== generation
  )
    throw Error('Stream ownership changed');
  // Service checks every frame independently. No per-chunk native host spawn is needed.
}
async function newSink(
  id: string,
  record: ResolverRecord,
  filename: string,
  total: number | null,
  deferred = false,
) {
  if (!record.scope) throw Error('Direct capture needs an explicit browser scope');
  if (!Number.isSafeInteger(record.sourceGeneration) || record.sourceGeneration! < 1)
    throw Error('Direct capture needs a current source generation');
  if (record.scope.private && !browser.storage.session)
    throw Error('Private capture requires ephemeral browser session storage');
  const identity: StreamIdentity = {
    stream_id: crypto.randomUUID(),
    scope: record.scope,
    source_generation: record.sourceGeneration!,
  };
  const sink = new DurableStreamSink(
    identity,
    new NativeStreamPort(() => browser.runtime.connectNative(HOST)),
    () => verifyStreamOwner(id, record.tabId, identity.scope, identity.source_generation),
    () => directOwners.release(record.tabId, identity.stream_id),
  );
  if (!deferred) await sink.begin({ kind: 'job', id }, filename, total);
  return sink;
}
async function armDirect(
  id: string,
  record: ResolverRecord,
  request: { url: string; method: string },
  filename = 'download',
) {
  if (!settings.directCapture || !record.scope) return false;
  // armDirect is called only inside the serialized resolver commit transition.
  await captureCancels.get(record.tabId)?.(true);
  captureCancels.delete(record.tabId);
  const sink = await newSink(id, record, filename, null, !request.url.startsWith('blob:'));
  directOwners.assign(record.tabId, id, sink.identity);
  let terminal = false;
  let lastState: string | undefined;
  const captureState = async (state: string) => {
    if (terminal || state === lastState) return;
    lastState = state;
    if (['complete', 'interrupted', 'detached'].includes(state)) terminal = true;
    await navigationStore.set({
      ['capture-' + id]: {
        state,
        tabId: record.tabId,
        scope: record.scope,
        sourceGeneration: record.sourceGeneration,
        streamId: sink.identity.stream_id,
        documentNonce: record.documentNonce,
        kind: request.url.startsWith('blob:') ? 'blob' : 'response',
      },
    });
  };
  try {
    if (request.url.startsWith('blob:')) {
      const tab = await browser.tabs.get(record.tabId);
      if (new URL(request.url).origin !== new URL(tab.url!).origin) {
        await sink.abort();
        throw Error('Blob frame origin mismatch');
      }
      const capability = crypto.randomUUID();
      await captureState('armed');
      const cancelBlob = (alreadySerialized = false) => {
        const stop = async () => {
          await sink.abort('cancelled').catch(() => {});
          blobReaders.delete(capability);
          await captureState('interrupted');
        };
        return alreadySerialized ? stop() : captureTransitions.run(record.tabId, stop);
      };
      captureCancels.set(record.tabId, cancelBlob);
      blobReaders.set(capability, {
        tabId: record.tabId,
        frameId: 0,
        scope: record.scope,
        sink,
        jobId: id,
        sourceGeneration: record.sourceGeneration!,
        captureState,
      });
      const failedBlob = () =>
        captureTransitions.run(record.tabId, async () => {
          await sink.abort().catch(() => {});
          await captureState('interrupted');
        });
      if (BROWSER === 'chromium')
        void browser.scripting
          .executeScript({
            target: { tabId: record.tabId, frameIds: [0] },
            func: readOwnedBlob,
            args: [request.url, capability, 192 * 1024],
          })
          .catch(failedBlob)
          .finally(() => blobReaders.delete(capability));
      else
        void browser.tabs
          .executeScript(record.tabId, {
            frameId: 0,
            code:
              '(' +
              readOwnedBlob.toString() +
              ')(' +
              JSON.stringify(request.url) +
              ',' +
              JSON.stringify(capability) +
              ',196608)',
          })
          .catch(failedBlob)
          .finally(() => blobReaders.delete(capability));
      return true;
    }
    if (BROWSER === 'chromium') {
      const api = (globalThis as any).chrome.debugger;
      const cancel = await armChromium(
        api,
        record.tabId,
        request,
        sink,
        async (state) => {
          await captureState(state);
          if (['interrupted', 'detached'].includes(state))
            await native('browser_status', {
              id,
              state: 'waiting_user',
              message:
                'Direct capture interrupted. Request a fresh provider action; original requests are never replayed.',
              bytes: sink.offset,
              total: null,
            }).catch(() => {});
        },
        async (headers) => {
          const metadata = originalResponseMetadata(headers);
          await sink.begin({ kind: 'job', id }, metadata.filename ?? filename, metadata.total);
        },
      );
      captureCancels.set(record.tabId, cancel);
    } else {
      if (
        !(await browser.permissions.contains({
          permissions: ['webRequest', 'webRequestBlocking'],
          origins: [sitePattern(request.url)],
        }))
      ) {
        await sink.abort();
        throw Error('Firefox direct capture needs response-filter permissions');
      }
      await captureState('armed');
      let taken = false;
      let requestId: string | undefined;
      let admit: (accepted: boolean) => void = () => {};
      const ready = new Promise<boolean>((resolve) => {
        admit = resolve;
      });
      const headers = (details: any) => {
        if (details.requestId !== requestId) return;
        browser.webRequest.onHeadersReceived.removeListener(headers);
        const values: Record<string, string> = Object.fromEntries(
          (details.responseHeaders ?? []).map((h: any) => [h.name.toLowerCase(), h.value ?? '']),
        );
        const file =
          details.statusCode === 200 &&
          (/attachment/i.test(values['content-disposition'] ?? '') ||
            !/(?:text\/html|json)/i.test(values['content-type'] ?? ''));
        if (!file) {
          directOwners.release(record.tabId, sink.identity.stream_id);
          admit(false);
          void native('browser_status', {
            id,
            state: 'waiting_user',
            message: 'Navigation response remains in its original browser context.',
            bytes: 0,
            total: null,
          }).catch(() => {});
          return;
        }
        const metadata = originalResponseMetadata(values);
        void sink.begin({ kind: 'job', id }, metadata.filename ?? filename, metadata.total).then(
          async () => {
            await captureState('streaming');
            admit(true);
          },
          () => {
            directOwners.release(record.tabId, sink.identity.stream_id);
            admit(false);
          },
        );
      };
      const listen = (details: any) => {
        if (
          taken ||
          details.tabId !== record.tabId ||
          details.frameId !== 0 ||
          details.url !== request.url ||
          details.method !== request.method
        )
          return;
        taken = true;
        requestId = details.requestId;
        takeFirefox(
          (browser.webRequest as any).filterResponseData(details.requestId),
          sink,
          () => {
            browser.webRequest.onBeforeRequest.removeListener(listen);
            browser.webRequest.onHeadersReceived.removeListener(headers);
            void captureState('interrupted');
            void native('browser_status', {
              id,
              state: 'waiting_user',
              message:
                'Firefox response capture failed. Request a fresh action in the owning browser; original requests are never replayed.',
              bytes: sink.offset,
              total: null,
            }).catch(() => {});
          },
          ready,
          (completed) => {
            browser.webRequest.onBeforeRequest.removeListener(listen);
            browser.webRequest.onHeadersReceived.removeListener(headers);
            void captureState(completed ? 'complete' : 'interrupted');
          },
        );
      };
      browser.webRequest.onHeadersReceived.addListener(
        headers,
        { urls: [sitePattern(request.url)] },
        ['responseHeaders'],
      );
      browser.webRequest.onBeforeRequest.addListener(listen, { urls: [sitePattern(request.url)] }, [
        'blocking',
      ]);
      const cancel = async () => {
        admit(false);
        browser.webRequest.onBeforeRequest.removeListener(listen);
        browser.webRequest.onHeadersReceived.removeListener(headers);
        await sink.abort('cancelled').catch(() => {});
        await captureState('interrupted');
      };
      captureCancels.set(record.tabId, cancel);
      setTimeout(() => {
        if (!taken) void cancel();
      }, 60000);
    }
    return false;
  } catch (error) {
    directOwners.release(record.tabId, sink.identity.stream_id);
    throw error;
  }
}
const ongoing = new Set<number>();
let settings: CaptureSettings = { ...defaults };
let observerInstalled = false;
let eventSnapshot: any = null;
let eventPoll: Promise<any> | null = null;
async function load() {
  settings = {
    ...defaults,
    ...((await browser.storage.local.get('settings')) as Record<string, any>).settings,
  };
  await menus();
  await observers();
  await recover();
  await browser.alarms.create('resolver-poll', { periodInMinutes: 0.5 });
  await discovery.poll();
  await pollResolvers();
}
async function native(command: string, args?: unknown): Promise<any> {
  if (command === 'navigation_scheduler' && (args as any)?.request?.action === 'reconcile')
    args = {
      ...(args as any),
      request: {
        ...(args as any).request,
        live: [...(args as any).request.live, ...(await discovery.liveRecords())],
      },
    };
  let projectionTicket: ProjectionTicket | undefined;
  if (
    [
      'navigation_scheduler',
      'claim_navigation',
      'resolve',
      'browser_status',
      'refresh_browser',
      'solve_challenge',
    ].includes(command)
  )
    args = { ...(args as object), owner: await profile };
  if (command === 'navigation_scheduler' && (args as any)?.request?.id) {
    const record = (await navigationStore.get('resolver-' + (args as any).request.id))[
      'resolver-' + (args as any).request.id
    ] as ResolverRecord | undefined;
    if (record?.scope) {
      const cleanup = (args as any).request.action === 'release';
      if (cleanup ? record.sessionEpoch !== (await browserEpoch) : !(await ownsCurrentTab(record)))
        throw Error('Scheduler tab authority changed');
      await renewAuthority('resolver-' + (args as any).request.id, record);
      args = { ...(args as object), scope: record.scope };
    } else {
      const scope = await discovery.scopeForJob((args as any).request.id);
      if (scope) args = { ...(args as object), scope };
    }
  }
  if (['add', 'navigate'].includes(command))
    args = { ...(args as any), context: { ...(args as any)?.context, profile: await profile } };
  if (['resolve', 'browser_status', 'refresh_browser', 'solve_challenge'].includes(command)) {
    const value = args as any;
    const stored = await navigationStore.get('resolver-' + value.id);
    const record = stored['resolver-' + value.id] as ResolverRecord | undefined;
    if (record && record.sessionEpoch !== (await browserEpoch))
      throw Error('Browser restarted; explicitly continue in the original context');
    args = {
      ...value,
      scope: record?.scope ?? null,
      source_generation: record?.sourceGeneration ?? null,
    };
  }
  if (command === 'snapshot' || command === 'subscribe') {
    const projection = await projectionScope();
    if (command === 'subscribe') {
      projectionTicket = subscriptionCursor.prepare(
        projection,
        (args as any)?.after_sequence ?? null,
      );
      args = { ...(args as any), after_sequence: projectionTicket.after_sequence };
    }
    command = command === 'snapshot' ? 'browser_snapshot' : 'browser_subscribe';
    args = { ...(args as any), ...projection };
  }
  const requestId = crypto.randomUUID();
  const response: any = await browser.runtime.sendNativeMessage(HOST, {
    version: 1,
    id: requestId,
    command,
    ...(args === undefined ? {} : { args }),
  });
  if (response?.id !== requestId || response?.version !== 1)
    throw Error('Invalid native response envelope');
  if (!response?.ok) throw Error(response?.error?.message ?? 'Native host unavailable');
  if (projectionTicket) subscriptionCursor.accept(projectionTicket);
  return response.data;
}
async function menus() {
  await browser.contextMenus.removeAll();
  const t = (key: Key) => translate(settings.locale, key);
  browser.contextMenus.create({
    id: 'navigate',
    title: t('navigatePage'),
    contexts: ['page', 'link'],
  });
  browser.contextMenus.create({
    id: 'link',
    title: t('downloadLink'),
    contexts: ['link'],
  });
  browser.contextMenus.create({
    id: 'page',
    title: t('downloadPage'),
    contexts: ['page', 'selection'],
  });
  browser.contextMenus.create({
    id: 'media',
    title: t('downloadMedia'),
    contexts: ['video', 'audio'],
  });
}
async function observers() {
  await serverNavigationObservers();
  if (observerInstalled) {
    await mediaScripts();
    return;
  }
  if (
    !(await browser.permissions.contains({
      permissions: ['webRequest'],
    }))
  )
    return;
  if (observerInstalled) {
    await mediaScripts();
    return;
  }
  observerInstalled = true;
  const observe = (details: any) =>
    void (async () => {
      if (details.tabId < 0 || details.frameId < 0) return;
      const records = await navigationStore.get(null);
      const resolver = Object.entries(records).find(
        ([key, value]: any) => key.startsWith('resolver-') && value.tabId === details.tabId,
      )?.[1] as ResolverRecord | undefined;
      const scope = await scopeForTab(
        browser as any,
        BROWSER,
        await profile,
        details.tabId,
        resolver?.scope?.claim_generation ?? 1,
        details.frameId,
      );
      const headers: Record<string, string> = {};
      for (const h of details.requestHeaders ?? [])
        if (
          ['referer', 'origin', 'user-agent', 'accept'].includes(h.name.toLowerCase()) &&
          h.value &&
          !/[\r\n]/.test(h.value)
        )
          headers[h.name] = h.value;
      const key = JSON.stringify([
        details.requestId,
        details.tabId,
        details.frameId,
        details.documentId,
        sessionKey(scope),
      ]);
      requests.set(key, {
        requestId: details.requestId,
        tabId: details.tabId,
        frameId: details.frameId,
        documentId: details.documentId,
        url: details.url,
        method: details.method,
        headers,
        time: Date.now(),
        scope,
      });
      for (const [id, record] of requests)
        if (Date.now() - record.time > 120000) requests.delete(id);
      if (requests.size > 1024) requests.delete(requests.keys().next().value!);
    })().catch(() => {});
  browser.webRequest.onBeforeRequest.addListener(
    (details: any) => {
      if (details.type === 'main_frame' && details.frameId === 0)
        serverRequests.begin(
          details,
          serverRequestAuthority(details.tabId).catch(() => null),
        );
      observe(details);
    },
    {
      urls: ['http://*/*', 'https://*/*'],
    },
  );
  browser.webRequest.onBeforeSendHeaders.addListener(
    observe,
    { urls: ['http://*/*', 'https://*/*'] },
    ['requestHeaders'],
  );
  browser.webRequest.onHeadersReceived.addListener(
    (details: any) => {
      if (
        details.type === 'main_frame' &&
        details.frameId === 0 &&
        [429, 503].includes(details.statusCode)
      ) {
        trackServerResponse(details.tabId, serverRequests.headers(details));
      }
      const type =
        details.responseHeaders?.find(
          (h: { name: string; value?: string }) => h.name.toLowerCase() === 'content-type',
        )?.value ?? '';
      if (/mpegurl|dash\+xml|^video\/|^audio\//i.test(type) && details.tabId >= 0)
        void browser.tabs
          .sendMessage(details.tabId, {
            type: 'media_source',
            url: details.url,
          })
          .catch(() => {});
    },
    { urls: ['http://*/*', 'https://*/*'] },
    ['responseHeaders'],
  );
  if (BROWSER === 'chromium') {
    try {
      await browser.scripting.registerContentScripts([
        {
          id: 'downloader-media',
          js: ['content.js'],
          matches:
            (await browser.permissions.getAll()).origins?.filter((o) => /^https?:/.test(o)) ?? [],
          allFrames: true,
          runAt: 'document_idle',
        },
      ]);
    } catch {}
  }
}
async function mediaScripts() {
  if (BROWSER !== 'chromium') return;
  const matches =
    (await browser.permissions.getAll()).origins?.filter((o) => /^https?:/.test(o)) ?? [];
  if (!matches.length) return;
  try {
    await browser.scripting.updateContentScripts([{ id: 'downloader-media', matches }]);
  } catch {}
}
async function context(url: string, privateSession = false): Promise<any> {
  const record = requestFor(url, privateSession);
  const headers = { ...record?.headers };
  if (!record) return { headers: {}, browser: BROWSER, private: privateSession };
  if (
    await browser.permissions.contains({ permissions: ['cookies'], origins: [sitePattern(url)] })
  ) {
    const current = await scopeForTab(
      browser as any,
      BROWSER,
      await profile,
      record.tabId,
      record.scope.claim_generation,
      record.frameId,
    );
    if (!sameScope(current, record.scope)) throw Error('Request cookie scope changed');
    const details: any = { url, storeId: record.scope.cookie_store_id };
    const unpartitioned = (await browser.cookies.getAll(details)).filter(
      (c) => !(c as any).partitionKey,
    );
    let cookies = unpartitioned;
    if (record.scope.partition_key) {
      details.partitionKey = {
        topLevelSite: record.scope.partition_key.top_level_site,
        hasCrossSiteAncestor: record.scope.partition_key.has_cross_site_ancestor,
      };
      cookies = [...unpartitioned, ...(await browser.cookies.getAll(details))];
    }
    if (cookies.length) headers.Cookie = cookies.map((c) => c.name + '=' + c.value).join('; ');
  }
  return { headers, browser: BROWSER, private: privateSession };
}
async function add(
  url: string,
  requestId: string = crypto.randomUUID(),
  filename?: string,
  privateSession = false,
  media = false,
) {
  return native('add', {
    request_id: requestId,
    url,
    filename: filename?.split(/[\\/]/).pop() ?? null,
    queue: null,
    checksum: null,
    directory: null,
    paused: false,
    description: '',
    context: await context(url, privateSession),
    media: media
      ? {
          format: null,
          audio_only: false,
          subtitles: false,
          thumbnail: false,
          playlist: false,
          container: 'mp4',
        }
      : null,
  });
}
async function capture(item: browser.Downloads.DownloadItem, resolverId?: string) {
  const download = item as Download;
  const browserJob = (jobId: string) => ({
    jobId,
    private: privateWorker || item.incognito === true,
  });
  let record =
    requestFor(download.finalUrl || item.url, Boolean(item.incognito)) ??
    requestFor(item.url, Boolean(item.incognito));
  if (!privateWorker && !item.incognito)
    await browser.storage.local.set({
      lastCapture: {
        observedMethod: record?.method ?? null,
        state: item.state,
        bytes: item.bytesReceived,
        assignedNavigation: Boolean(resolverId),
      },
    });
  if (ongoing.has(item.id)) return;
  const replayable =
    classifyReplay({ method: record?.method, sourceGeneration: 1 }).disposition === 'replayable';
  if (resolverId && (!replayable || item.state === 'complete')) {
    await navigationStore.set({ ['browser-job-' + item.id]: browserJob(resolverId) });
    await native('browser_status', {
      id: resolverId,
      state: item.state === 'complete' ? 'browser_complete' : 'browser_downloading',
      message:
        'This request must finish in the browser (POST, blob, or unavailable request context).',
      bytes: item.bytesReceived,
      total: item.totalBytes > 0 ? item.totalBytes : null,
    });
    return;
  }
  if (!resolverId && (!replayable || !eligible(download, settings, record?.method))) return;
  ongoing.add(item.id);
  const key = 'pending-' + item.id;
  void handoff(download, {
    pause: (id) => browser.downloads.pause(id),
    resume: (id) => browser.downloads.resume(id),
    cancel: (id) => browser.downloads.cancel(id),
    create: async (id) =>
      resolverId
        ? native('resolve', {
            id: resolverId,
            url: (item as Download).finalUrl || item.url,
            filename: item.filename.split(/[\\/]/).pop() || null,
            context: await context((item as Download).finalUrl || item.url, item.incognito),
          })
        : add((item as Download).finalUrl || item.url, id, item.filename, item.incognito),
    job: async (id) => (await browserSnapshot()).jobs.find((j: any) => j.id === id),
    cancelNative: async (id) => {
      if (resolverId) {
        await native('pause', { id });
        for (let attempt = 0; attempt < 50; attempt++) {
          const job = (await browserSnapshot()).jobs.find((job: any) => job.id === id);
          if (
            !job ||
            !['connecting', 'downloading', 'verifying', 'assembling', 'scanning'].includes(
              job.state,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await navigationStore.set({
          ['browser-job-' + item.id]: browserJob(resolverId),
        });
        await native('browser_status', {
          id,
          state: 'browser_downloading',
          message: 'Desktop handoff failed; the browser retains the download.',
          bytes: item.bytesReceived,
          total: item.totalBytes > 0 ? item.totalBytes : null,
        });
      } else await native('cancel', { id });
    },
    pending: async (value) => {
      if (value) await navigationStore.set({ [key]: value });
      else await navigationStore.remove(key);
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
    .then(async (outcome) => {
      if (resolverId && outcome === 'browser') {
        const [current] = await browser.downloads.search({ id: item.id });
        if (current) {
          await navigationStore.set({ ['browser-job-' + item.id]: browserJob(resolverId) });
          await native('browser_status', {
            id: resolverId,
            state: current.state === 'complete' ? 'browser_complete' : 'browser_downloading',
            message: 'The browser retains this download because desktop handoff could not finish.',
            bytes: current.bytesReceived,
            total: current.totalBytes > 0 ? current.totalBytes : null,
          }).catch(() => {});
        }
      }
    })
    .catch(async (e) => {
      await reportError(e);
    })
    .finally(() => ongoing.delete(item.id));
}
browser.downloads.onCreated.addListener(
  (item) => void resolveDownload(item).catch((e) => reportError(e, !!item.incognito)),
);
async function resolveDownload(item: browser.Downloads.DownloadItem) {
  const tabId =
    (item as any).tabId ??
    requestFor((item as Download).finalUrl || item.url)?.tabId ??
    requestFor(item.url)?.tabId;
  const stored: Record<string, any> = await navigationStore.get(null);
  let entry = Object.entries(stored).find(
    ([key, value]) => key.startsWith('resolver-') && value.tabId === tabId,
  );
  // DownloadItem has no guaranteed tab ID. Chrome can also report -1 for
  // download requests. Match a unique assigned tab by its browser referrer.
  if (!entry && item.referrer) {
    const matches: [string, any][] = [];
    for (const candidate of Object.entries(stored)) {
      if (!candidate[0].startsWith('resolver-') || candidate[1].downloadId) continue;
      const tab = await browser.tabs.get(candidate[1].tabId).catch(() => undefined);
      if (tab?.url === item.referrer) matches.push(candidate);
    }
    if (matches.length === 1) entry = matches[0];
  }
  if (entry) {
    const id = entry[0].slice('resolver-'.length);
    if (directOwners.owns(entry[1].tabId, id, entry[1].scope, entry[1].sourceGeneration ?? 1))
      return;
    await navigationStore.set({
      [entry[0]]: { ...entry[1], downloadId: item.id },
    });
    await capture(item, id);
  } else await capture(item);
}
browser.downloads.onChanged.addListener(
  (delta) =>
    void (async () => {
      const key = 'browser-job-' + delta.id,
        record: Record<string, any> = await navigationStore.get(key);
      const [item] = await browser.downloads.search({ id: delta.id });
      if (!item) return;
      if (record[key]?.jobId) {
        await native('browser_status', {
          id: record[key].jobId,
          state:
            item.state === 'complete'
              ? 'browser_complete'
              : item.state === 'interrupted'
                ? 'failed'
                : 'browser_downloading',
          message:
            item.state === 'complete'
              ? 'Saved by the browser. Use the browser download list to open the file.'
              : (item.error ?? 'Download remains in the browser.'),
          bytes: item.bytesReceived,
          total: item.totalBytes > 0 ? item.totalBytes : null,
        }).catch(() => {});
        if (item.state !== 'in_progress') await navigationStore.remove(key);
      } else if (delta.filename) await resolveDownload(item);
    })().catch(() => {}),
);
async function recover() {
  const storage: Record<string, any> = await navigationStore.get(null);
  await recoverDirectCaptures(storage);
  for (const [key, value] of Object.entries(storage)) {
    if (!key.startsWith('pending-') || !value) continue;
    const p = value as any;
    try {
      const snap = await browserSnapshot();
      const job = snap.jobs.find((j: any) => j.id === p.jobId || j.request_id === p.requestId);
      if (
        job &&
        p.replay?.disposition === 'replayable' &&
        p.sourceGeneration === job.source_generation &&
        p.scope &&
        sameScope(p.scope, job.navigation_scope) &&
        (job.viable || job.state === 'complete')
      )
        await browser.downloads.cancel(p.downloadId);
      else {
        if (job) await native('cancel', { id: job.id });
        await browser.downloads.resume(p.downloadId);
      }
      await navigationStore.remove(key);
    } catch {
      try {
        await browser.downloads.resume(p.downloadId);
        await navigationStore.remove(key);
      } catch {}
    }
  }
}
const recoveringStreams = new Set<string>();
async function recoverDirectCaptures(storage: Record<string, any>) {
  for (const [key, capture] of Object.entries(storage)) {
    if (
      !key.startsWith('capture-') ||
      !capture?.scope ||
      !['armed', 'taking_original_response', 'streaming', 'interrupted', 'detached'].includes(
        capture.state,
      )
    )
      continue;
    const id = key.slice(8),
      record = storage['resolver-' + id] as ResolverRecord | undefined;
    if (
      !record?.scope ||
      recoveringStreams.has(id) ||
      directOwners.owns(record.tabId, id, record.scope, record.sourceGeneration!)
    )
      continue;
    recoveringStreams.add(id);
    try {
      await captureTransitions.run(record.tabId, async () => {
        // Admission may have waited behind a fresh commit; use its current markers/owner.
        const latest = await navigationStore.get([key, 'resolver-' + id]);
        const currentCapture = latest[key],
          currentRecord = latest['resolver-' + id];
        if (
          !currentRecord?.scope ||
          !(await ownsCurrentTab(currentRecord)) ||
          directOwners.owns(
            currentRecord.tabId,
            id,
            currentRecord.scope,
            currentRecord.sourceGeneration,
          )
        )
          return;
        const job = (await browserSnapshot()).jobs.find((row: any) => row.id === id);
        const identity = orphanedStreamIdentity(
          currentCapture,
          currentRecord,
          job,
          await browserEpoch,
        );
        if (!identity) return;
        const port = new NativeStreamPort(() => browser.runtime.connectNative(HOST));
        try {
          await recoverStreamAbort(
            currentCapture,
            identity,
            (current) =>
              port.operation({ ...current, operation: 'abort', reason: 'worker_interrupted' }),
            job.state,
          );
        } finally {
          port.close();
        }
        await native('browser_status', {
          id,
          state: 'waiting_user',
          message:
            'browser_worker_interrupted: request a fresh action in the owning browser; original requests are never replayed',
          bytes: job.bytes,
          total: job.total,
        });
        await navigationStore.set({ [key]: { ...currentCapture, state: 'interrupted' } });
      });
    } catch {
      /* Keep the marker so the next service/poll recovery can retry its exact abort. */
    } finally {
      recoveringStreams.delete(id);
    }
  }
}
browser.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    if (info.menuItemId === 'navigate') {
      const url = info.linkUrl || tab?.url;
      if (url && (await navigationPermissions(url))) {
        if (tab?.id === undefined) throw new NavigationSourceError('navigation_source_missing');
        const requestId = crypto.randomUUID();
        await navigationSources.prepare(requestId, tab.id);
        const job = await native('navigate', {
          request_id: requestId,
          url,
          paused: true,
          description: '',
          context: { headers: {}, private: tab?.incognito ?? false },
          media: null,
          filename: null,
          directory: null,
          queue: null,
          checksum: null,
        });
        await startResolver(job, false, tab.id);
      }
    }
    if (info.menuItemId === 'link' && info.linkUrl)
      await add(info.linkUrl, undefined, undefined, tab?.incognito);
    if (info.menuItemId === 'media' && info.srcUrl && !info.srcUrl.startsWith('blob:'))
      await add(info.srcUrl, undefined, undefined, tab?.incognito, true);
    if (info.menuItemId === 'page' && tab?.id) {
      const links = await browser.tabs.sendMessage(tab.id, {
        type: 'collect_links',
        selection: info.selectionText != null,
      });
      for (const url of (links as string[]).slice(0, 1000))
        await add(url, undefined, undefined, tab.incognito);
    }
  })().catch((e) => reportError(e));
});
browser.runtime.onMessage.addListener((message: any, sender: browser.Runtime.MessageSender) => {
  if (sender.id !== browser.runtime.id) return Promise.reject(Error('Unknown message sender'));
  const extensionPage =
    sender.url === browser.runtime.getURL('options.html') ||
    sender.url === browser.runtime.getURL('popup.html');
  if (extensionPage && message.type === 'navigation_transfer_preview')
    return navigationTransfer.preview(message.token, message.tabId);
  if (extensionPage && message.type === 'navigation_transfer_accept')
    return navigationTransfer.accept(message.previewId, message.consent);
  if (extensionPage && message.type === 'navigation_transfer_discard') {
    navigationTransfer.discard(message.previewId);
    return Promise.resolve(true);
  }
  if (sender.tab && !extensionPage) {
    if (message.type === 'discovery_context') return discovery.context(sender, message.document);
    if (message.type === 'discovery_page_result')
      return discovery.result(sender, message.result, message.document);
    if (message.type === 'owned_blob_stream')
      return (async () => {
        const reader = blobReaders.get(message.capability);
        if (!reader || reader.tabId !== sender.tab!.id || reader.frameId !== (sender.frameId ?? 0))
          throw Error('Unknown page stream capability');
        await verifyStreamOwner(reader.jobId, reader.tabId, reader.scope, reader.sourceGeneration);
        if (message.operation === 'chunk') {
          await reader.captureState('streaming');
          if (typeof message.data_base64 !== 'string' || message.data_base64.length > 262144)
            throw Error('Page chunk exceeds bound');
          await reader.sink.chunk(
            Uint8Array.from(atob(message.data_base64), (c: string) => c.charCodeAt(0)),
          );
        } else if (message.operation === 'end') {
          await reader.sink.end();
          await reader.captureState('complete');
          blobReaders.delete(message.capability);
        } else if (message.operation === 'abort') {
          await captureTransitions.run(reader.tabId, async () => {
            await reader.sink.abort();
            await reader.captureState('interrupted');
            blobReaders.delete(message.capability);
          });
        } else throw Error('Unknown page stream operation');
        return true;
      })();
    if (message.type === 'resolver_account')
      return resolverAccount(
        message,
        sender.tab.id!,
        sender.frameId ?? 0,
        (sender as any).documentId,
      );
    if (message.type === 'resolver_context')
      return resolverContext(
        sender.tab.id!,
        sender.frameId ?? 0,
        (sender as any).documentId,
        message.document,
      );
    if (
      [
        'resolver_challenge_select',
        'resolver_challenge_authorize',
        'resolver_challenge_paid',
      ].includes(message.type)
    )
      return challengeMessage(message, sender);
    if (
      ['resolver_step', 'resolver_commit', 'resolver_abort', 'resolver_disable_adapter'].includes(
        message.type,
      )
    ) {
      if ((sender.frameId ?? 0) !== 0)
        return Promise.reject(Error('Top-level navigation required'));
      const tabId = sender.tab.id!;
      const work = (resolverSteps.get(tabId) ?? Promise.resolve())
        .catch(() => {})
        .then(() =>
          resolverAction(message, tabId, sender.tab!.url ?? '', (sender as any).documentId),
        );
      resolverSteps.set(tabId, work);
      void work
        .finally(() => {
          if (resolverSteps.get(tabId) === work) resolverSteps.delete(tabId);
        })
        .catch(() => {});
      return work;
    }
    if (message.type !== 'download_media')
      return Promise.reject(Error('Content scripts cannot control the native host'));
  }
  if (extensionPage && message.type === 'discovery_projects')
    return discovery.projects(message.tabId);
  if (extensionPage && message.type === 'discovery_start')
    return discovery.start(message.id, message.tabId, message.permittedOrigins);
  if (extensionPage && message.type === 'navigation_scheduler')
    return scheduler.request(message.request);
  if (extensionPage && message.type === 'navigation_queue_cancel')
    return (async () => {
      const sourceJob = (await native('snapshot')).jobs.find((job: any) => job.id === message.id);
      if (!sourceJob) throw Error('Navigation task unavailable');
      const storage = await navigationStore.get('resolver-' + message.id);
      const record = storage['resolver-' + message.id] as ResolverRecord | undefined;
      await cancelNavigationTask(sourceJob, record, {
        owner: await profile,
        native,
        owns: ownsCurrentTab,
        invalidate: async (job) => {
          if (record) await clearServerResponse(record.tabId);
          await navigationSources.invalidate(job);
        },
        release: (id) => scheduler.release(id),
        removeRecord: (id) => navigationStore.remove('resolver-' + id),
        closeTab: (tabId) => browser.tabs.remove(tabId),
      });
      await pollResolvers();
      return true;
    })();
  if (extensionPage && message.type === 'navigation_queue_continue')
    return (async () => {
      const job = (await browserSnapshot()).jobs.find((j: any) => j.id === message.id);
      if (!job?.page_url) throw Error('Navigation task unavailable');
      if (!(await navigationPermissions(job.navigation_url ?? job.page_url)))
        throw Error('Site permission required');
      const record = (await navigationStore.get('resolver-' + job.id))['resolver-' + job.id] as
        ResolverRecord | undefined;
      if (job.navigation_transfer_recovery) {
        if (!record || !(await ownsCurrentTab(record)))
          throw Error('Reopen the original session or prepare a new desktop transfer');
        const renewed = await native('browser_navigation_transfer', {
          action: 'continue',
          id: job.id,
          scope: record.scope,
          source_generation: record.sourceGeneration,
          consent: true,
        });
        record.scope = renewed.scope;
        record.sourceGeneration = renewed.source_generation;
        record.generation = renewed.source_generation;
        await navigationStore.set({ ['resolver-' + job.id]: record });
        job.navigation_transfer_recovery = false;
        job.navigation_scope = renewed.scope;
        job.source_generation = renewed.source_generation;
      }
      const state = await scheduler.request({ action: 'snapshot' });
      if (record?.wait && state.tasks.find((task) => task.id === job.id)?.status === 'waiting')
        await scheduler.observe(job.id);
      else {
        if (record) {
          delete record.wait;
          delete record.waitStarted;
          await navigationStore.set({ ['resolver-' + job.id]: record });
        }
        await startResolver(job, true);
      }
      return true;
    })();
  if (message.type === 'continue_navigation')
    return navigationPermissions(message.url).then(async (allowed) => {
      if (!allowed) throw Error('Site permissions are required to navigate download pages');
      await pollResolvers(true);
      return true;
    });
  if (message.type === 'try_solver')
    return (async () => {
      const job = (await browserSnapshot()).jobs.find((j: any) => j.id === message.id);
      if (!job || !['waiting_browser', 'waiting_user'].includes(job.state))
        throw Error('Job is not waiting for browser navigation');
      return native('solve_challenge', {
        id: job.id,
        url: job.navigation_url ?? job.page_url,
        automatic: false,
      });
    })();
  if (message.type === 'capture_status')
    return (async () => {
      const scope = await projectionScope();
      const records = await navigationStore.get(null);
      return Object.entries(records)
        .filter(
          ([key, value]: any) =>
            key.startsWith('capture-') &&
            scope.scopes.some((s) =>
              Boolean(
                (records['resolver-' + key.slice(8)] as ResolverRecord | undefined)?.scope &&
                sameScope(s, (records['resolver-' + key.slice(8)] as ResolverRecord).scope!),
              ),
            ),
        )
        .map(([key, value]: any) => ({ id: key.slice(8), state: value.state }));
    })();
  if (message.type === 'cancel_capture')
    return (async () => {
      const records = await navigationStore.get('resolver-' + message.id);
      const record = records['resolver-' + message.id] as ResolverRecord | undefined;
      if (!record?.scope) throw Error('Capture is not owned');
      await verifyStreamOwner(message.id, record.tabId, record.scope, record.sourceGeneration ?? 1);
      await captureCancels.get(record.tabId)?.();
      captureCancels.delete(record.tabId);
      for (const [key, reader] of blobReaders)
        if (reader.jobId === message.id) {
          await reader.sink.abort('cancelled');
          blobReaders.delete(key);
        }
      return true;
    })();
  if (message.type === 'settings_changed') return load().then(() => true);
  if (message.type === 'diagnostics')
    return native('diagnostics').then(async (desktop) => ({
      ...desktop,
      integration: {
        observerInstalled,
        requestRecords: requests.size,
        ...(await browser.storage.local.get(['lastCapture', 'lastError'])),
      },
    }));
  if (message.type === 'refresh_session')
    return (async () => {
      const job = (await browserSnapshot()).jobs.find((j: any) => j.id === message.id);
      if (!job || !['waiting_authentication', 'waiting_source'].includes(job.state))
        throw Error('Job is not waiting for a session');
      const url = new URL(message.url).href;
      await native('refresh_browser', {
        id: job.id,
        url,
        context: await context(url, job.private ?? false),
      });
      return true;
    })();
  if (message.type === 'snapshot') return browserSnapshot();
  if (message.type === 'bypass') {
    settings.bypassUntil = Date.now() + 300000;
    return browser.storage.local.set({ settings });
  }
  if (message.type === 'download_media') {
    if (!sender.tab?.url || excluded(sender.tab.url, settings.excluded))
      return Promise.reject(Error('Site excluded'));
    const page = new URL(sender.tab.url);
    const url = new URL(message.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return Promise.reject(Error('Unsupported media source'));
    // A content script can request a media download, never native control commands.
    return add(url.href, undefined, undefined, sender.tab.incognito, true);
  }
  return undefined;
});
browser.permissions.onAdded.addListener(() => void observers());
browser.storage.onChanged.addListener((changes) => {
  if (changes.settings)
    settings = {
      ...defaults,
      ...(changes.settings.newValue as Partial<CaptureSettings>),
    };
});
browser.runtime.onInstalled.addListener((details) => {
  void load();
  if (details.reason === 'install') void browser.runtime.openOptionsPage();
});
void load();

type ResolverRecord = {
  scope?: SessionScope;
  sourceGeneration?: number;
  documentGeneration?: number;
  sessionEpoch?: string;
  documentId?: string;
  documentNonce?: string;
  tabId: number;
  started: number;
  steps: number;
  fingerprint?: string;
  clickedAt?: number;
  downloadId?: number;
  request?: { method: string; url: string };
  wait?: DurableWait;
  serverWaitDocumentId?: string;
  waitStarted?: number;
  waitedMs?: number;
  generation?: number;
  lastOrigin?: string;
  private?: boolean;
};
async function navigationPermissions(url: string) {
  const required: browser.Permissions.Permissions = {
    permissions: [
      'webRequest',
      'cookies',
      ...(BROWSER === 'chromium'
        ? ['scripting' as const, 'webNavigation' as const]
        : ['webRequestBlocking' as const]),
    ],
    origins: [sitePattern(url)],
  };
  if (await browser.permissions.contains(required)) return true;
  return browser.permissions.request(required);
}

async function injectResolver(tabId: number) {
  if (BROWSER === 'chromium')
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['resolver.js'],
    });
  else
    await browser.tabs.executeScript(tabId, {
      file: 'resolver.js',
      runAt: 'document_idle',
    });
}
const resolverStarts = new NavigationStarts();
async function startResolver(job: any, force = false, sourceTabId?: number) {
  return resolverStarts.run(job.id, () => startOwnedResolver(job, force, sourceTabId));
}
async function pendingNavigationSource(job: any, sourceTabId?: number) {
  try {
    if (sourceTabId !== undefined) await navigationSources.remember(job, sourceTabId);
    return (await navigationSources.resolve(job)) ?? sourceTabId;
  } catch (error) {
    if (error instanceof NavigationSourceError) {
      await navigationSources.invalidate(job);
      await native('browser_status', {
        id: job.id,
        state: 'waiting_user',
        bytes: job.bytes ?? 0,
        total: job.total ?? null,
        message: `${error.code}: Original browser context is unavailable. Continue from its original session or use explicit session transfer.`,
      }).catch(() => {});
      await scheduler.release(job.id).catch(() => {});
    }
    throw error;
  }
}
async function startOwnedResolver(job: any, force = false, sourceTabId?: number) {
  // Freeze the observed source before awaits; cached snapshot DTOs can change in place.
  job = structuredClone(job);
  if (job.navigation_transfer_pending || job.navigation_transfer_recovery) {
    await navigationSources.invalidate(job);
    throw Error('Explicit session transfer or recovery is required');
  }
  const startUrl = job.navigation_url ?? job.page_url;
  if (!/^https?:\/\//.test(startUrl)) throw Error('Page navigation requires HTTP or HTTPS');
  if (force)
    await scheduler.request({ action: 'control', id: job.id, paused: false, priority: null });
  const key = 'resolver-' + job.id,
    stored = await navigationStore.get(key);
  if (stored[key] && (stored[key] as ResolverRecord).sessionEpoch !== (await browserEpoch)) {
    if (!force)
      throw Error('Browser restarted; explicitly continue this task in its original context');
    await navigationStore.remove(key);
    delete stored[key];
  }
  if (stored[key]) {
    if (
      !(await admittedNavigationJob(
        job,
        () => scheduler.admitted(job.id),
        // A new native BrowserSnapshot reads the current store; do not use browserSnapshot's event cache.
        () => native('snapshot'),
      ))
    )
      return;
    const record = stored[key] as ResolverRecord;
    try {
      if (!(await ownsCurrentTab(record)))
        throw Error('Original navigation tab context unavailable');
      await renewAuthority(key, record);
      if (
        !force &&
        (await hasLiveResolver(browser, BROWSER, record.tabId, {
          nonce: record.documentNonce,
          documentId: record.documentId,
        }))
      ) {
        await scheduler.heartbeat(job.id, record.tabId);
        return;
      }
      await browser.tabs.update(record.tabId, { active: true });
      const proposed = await scopeForTab(
        browser as any,
        BROWSER,
        await profile,
        record.tabId,
        record.scope?.claim_generation ?? 1,
      );
      if (record.scope && !sameScope(record.scope, proposed))
        throw Error('Task session changed; explicit transfer required');
      if (force) {
        navigationAuthorizations.invalidateTab(record.tabId);
        premiumAuthorizations.invalidateTab(record.tabId);
        await captureCancels.get(record.tabId)?.();
        captureCancels.delete(record.tabId);
        for (const [readerKey, reader] of blobReaders)
          if (reader.jobId === job.id) {
            await reader.sink.abort('navigation_scope_replaced');
            blobReaders.delete(readerKey);
          }
      }
      const claim = await native('claim_navigation', {
        id: job.id,
        force,
        scope: proposed,
        source_generation: record.sourceGeneration ?? job.source_generation,
      });
      record.scope = claim.scope;
      record.sourceGeneration = claim.source_generation;
      record.generation = claim.source_generation;
      record.started = Date.now();
      record.steps = 0;
      // Scheduler native requests read their exact scope from the stored record.
      await navigationStore.set({ [key]: record });
      await scheduler.heartbeat(job.id, record.tabId);
      await injectResolver(record.tabId);
      await browser.tabs.sendMessage(record.tabId, {
        type: 'resolver_continue',
      });
      return;
    } catch (error) {
      // A tab ID is not authority to substitute a new session after an error.
      throw error;
    }
  }
  sourceTabId = await pendingNavigationSource(job, sourceTabId);
  if (
    !(await admittedNavigationJob(
      job,
      () => scheduler.admitted(job.id),
      // A new native BrowserSnapshot reads the current store; do not use browserSnapshot's event cache.
      () => native('snapshot'),
    ))
  )
    return;
  // Admission can wait; revalidate the observed source before using its window/store.
  sourceTabId = await pendingNavigationSource(job, sourceTabId);
  const source = sourceTabId === undefined ? undefined : await browser.tabs.get(sourceTabId);
  if (job.private && (!browser.storage.session || source?.incognito !== true || !privateWorker))
    throw Error(
      'Private navigation needs the original private context and ephemeral session storage',
    );
  if (
    (job.private || job.navigation_scope?.private || job.navigation_scope?.container_id) &&
    !source
  )
    throw Error(
      'Reopen the original private/container task explicitly; default tab substitution denied',
    );
  if (source && Boolean(source.incognito) !== Boolean(job.private))
    throw Error('Source tab private context does not match task');
  const createdAt = Date.now();
  const tab = await browser.tabs.create({
    url: startUrl,
    active: true,
    ...(source?.windowId !== undefined ? { windowId: source.windowId } : {}),
    ...(BROWSER === 'firefox' && source?.cookieStoreId
      ? { cookieStoreId: source.cookieStoreId }
      : {}),
  });
  for (let attempts = 0; attempts < 200; attempts++) {
    if ((await browser.tabs.get(tab.id!)).status === 'complete') break;
    if (attempts === 199) throw Error('Page did not settle before its session claim');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // The fresh destination partition is observed after load; no source partition is inherited.
  await pendingNavigationSource(job, sourceTabId);
  const proposed = await scopeForTab(
    browser as any,
    BROWSER,
    await profile,
    tab.id!,
    job.navigation_scope?.claim_generation ?? 1,
  );
  const claim = await native('claim_navigation', {
    id: job.id,
    force,
    scope: proposed,
    source_generation: job.source_generation,
  });
  await navigationStore.set({
    [key]: {
      tabId: tab.id!,
      scope: claim.scope,
      sourceGeneration: claim.source_generation,
      sessionEpoch: await browserEpoch,
      started: Date.now(),
      steps: 0,
      generation: claim.source_generation,
      lastOrigin: new URL(startUrl).origin,
      private: job.private ?? false,
    } satisfies ResolverRecord,
  });
  trackServerResponse(
    tab.id!,
    serverRequests.adoptInitial(
      {
        id: job.id,
        tabId: tab.id!,
        scope: claim.scope,
        sourceGeneration: claim.source_generation,
        sessionEpoch: await browserEpoch,
      },
      { id: job.id, sourceGeneration: job.source_generation, url: startUrl, createdAt },
    ),
  );
  await serverHeaderWrites.get(tab.id!);
  await native('browser_status', {
    id: job.id,
    state: 'waiting_browser',
    message: 'Following the free download steps in the browser.',
    bytes: 0,
    total: null,
  });
  await navigationSources.adopted(job);
  await scheduler.heartbeat(job.id, tab.id!);
  await injectResolver(tab.id!);
}
let polling = false;
async function pollResolvers(userGesture = false) {
  if (polling) return;
  polling = true;
  try {
    await recoverDirectCaptures(await navigationStore.get(null));
    const snapshot = await browserSnapshot();
    for (const job of snapshot.jobs)
      if (
        job.navigation_transfer_pending ||
        job.navigation_transfer_recovery ||
        ['complete', 'browser_complete', 'cancelled', 'failed'].includes(job.state)
      )
        await navigationSources.invalidate(job);
    const storage: Record<string, any> = await navigationStore.get(null);
    const liveKeys = new Set<string>();
    for (const [key, value] of Object.entries(storage))
      if (key.startsWith('resolver-') && (await ownsCurrentTab(value))) liveKeys.add(key);
    if (!schedulerRecovered) {
      await scheduler.reconcile(
        Object.entries(storage)
          .filter(
            ([key]) =>
              liveKeys.has(key) &&
              !snapshot.jobs.some(
                (job: any) =>
                  job.id === key.slice(9) &&
                  (job.navigation_transfer_pending || job.navigation_transfer_recovery),
              ),
          )
          .map(([key, record]) => ({
            id: key.slice(9),
            tabId: record.tabId,
            origin: record.lastOrigin,
            private: record.private,
            cookieStoreId: record.scope?.cookie_store_id,
            scope: record.scope,
          })),
      );
      schedulerRecovered = true;
    }
    const active: any[] = [];
    for (const [key, record] of Object.entries(storage)) {
      if (!key.startsWith('resolver-') || !liveKeys.has(key)) continue;
      const job = snapshot.jobs.find((job: any) => job.id === key.slice(9));
      if (job?.navigation_transfer_pending || job?.navigation_transfer_recovery) continue;
      if (!job || ['complete', 'browser_complete', 'cancelled', 'failed'].includes(job.state)) {
        await scheduler.release(key.slice(9));
        await navigationStore.remove(key);
        await browser.tabs.remove(record.tabId).catch(() => {});
      } else {
        const tab = await browser.tabs.get(record.tabId).catch(() => null);
        if (tab) {
          await scheduler.heartbeat(job.id, record.tabId);
          if (record.wait) await scheduler.observe(job.id);
        } else {
          await navigationStore.remove(key);
          await scheduler.reconcile(
            Object.entries(storage)
              .filter(([otherKey]) => liveKeys.has(otherKey) && otherKey !== key)
              .map(([otherKey, r]) => ({
                id: otherKey.slice(9),
                tabId: r.tabId,
                scope: r.scope,
                origin: r.lastOrigin,
                private: r.private,
                cookieStoreId: r.scope?.cookie_store_id,
              })),
          );
        }
        active.push(job);
      }
    }
    for (const job of snapshot.jobs.filter(
      (j: any) =>
        j.page_url &&
        (j.state === 'waiting_browser' || (userGesture && j.state === 'waiting_user')),
    )) {
      const allowed = await browser.permissions.contains({
        permissions: ['webRequest', ...(BROWSER === 'chromium' ? ['scripting' as const] : [])],
        origins: [sitePattern(job.navigation_url ?? job.page_url)],
      });
      if (!allowed) {
        continue;
      }
      const stored: Record<string, any> = await navigationStore.get('resolver-' + job.id);
      if (!stored['resolver-' + job.id]) {
        // startResolver validates pending origins before its atomic service admission.
        try {
          await startResolver(job, userGesture, await discovery.sourceForJob(job));
          active.push(job);
        } catch {}
      } else if (userGesture) await startResolver(job, true).catch(() => {});
    }
  } catch {
  } finally {
    polling = false;
  }
}
function authorizationBinding(
  message: any,
  record: ResolverRecord,
  tabId: number,
  page: string,
  documentId?: string,
): NavigationAuthorizationBinding {
  const binding = message.binding;
  const adapter = matchAdapter(page, settings.disabledAdapters ?? []);
  if (
    !record.scope ||
    !binding ||
    binding.tabId !== tabId ||
    binding.frameId !== 0 ||
    binding.page !== page ||
    binding.sessionKey !== sessionKey(record.scope) ||
    binding.claimGeneration !== record.scope.claim_generation ||
    binding.sourceGeneration !== record.sourceGeneration ||
    binding.documentGeneration !== record.documentGeneration ||
    binding.documentNonce !== record.documentNonce ||
    message.document?.nonce !== record.documentNonce ||
    binding.adapterId !== adapter.id ||
    binding.adapterVersion !== adapter.version ||
    binding.fingerprint !== message.fingerprint ||
    (record.documentId && record.documentId !== documentId)
  )
    throw Error('navigation_authorization_stale');
  return {
    tabId,
    frameId: 0,
    documentId,
    page,
    scope: record.scope,
    sourceGeneration: record.sourceGeneration!,
    documentGeneration: binding.documentGeneration,
    documentNonce: record.documentNonce!,
    adapterId: adapter.id,
    adapterVersion: adapter.version,
    fingerprint: binding.fingerprint,
  };
}
async function resolverAction(message: any, tabId: number, page: string, documentId?: string) {
  if (message.type === 'resolver_abort') {
    navigationAuthorizations.cancel(message.token);
    premiumAuthorizations.cancel(message.token);
    if (committedAuthorizations.get(message.token) === tabId) {
      committedAuthorizations.delete(message.token);
      await captureCancels.get(tabId)?.();
      captureCancels.delete(tabId);
    }
    return true;
  }
  const ctx = await resolverContext(tabId, 0, documentId, message.document);
  if (!ctx) {
    if (message.token) {
      navigationAuthorizations.cancel(message.token);
      premiumAuthorizations.cancel(message.token);
    }
    throw Error('navigation_authorization_stale');
  }
  await serverHeaderWrites.get(tabId);
  if (message.type === 'resolver_step') return resolverStep(message, tabId, page, ctx.documentId);
  if (message.type === 'resolver_disable_adapter') {
    const adapter = matchAdapter(page);
    if (adapter.id === 'generic' || adapter.id !== message.adapterId)
      throw Error('adapter_disable_rejected');
    settings.disabledAdapters = [...new Set([...(settings.disabledAdapters ?? []), adapter.id])];
    await browser.storage.local.set({ settings });
    navigationAuthorizations.invalidateTab(tabId);
    premiumAuthorizations.invalidateTab(tabId);
    return true;
  }
  return captureTransitions.run(tabId, () =>
    resolverCommitSerialized(message, tabId, page, documentId),
  );
}
async function resolverCommitSerialized(
  message: any,
  tabId: number,
  page: string,
  documentId?: string,
) {
  const entries = await navigationStore.get(null);
  const entry = Object.entries(entries).find(
    ([key, value]: any) => key.startsWith('resolver-') && value.tabId === tabId,
  );
  if (!entry) throw Error('navigation_authorization_stale');
  const record = entry[1] as ResolverRecord,
    id = entry[0].slice(9);
  if (interruptedCaptureMatches(entries['capture-' + id], record))
    throw Error('navigation_authorization_stale');
  await applyServerWait(id, record, documentId);
  if (await scheduler.serverBlocked(id)) throw Error('navigation_server_wait');
  const bound = authorizationBinding(message, record, tabId, page, documentId);
  const premium = premiumAuthorizations.has(message.token);
  const action = navigationAuthorizations.consume(message.token, bound);
  if (premium) {
    const selection = (await native('browser_account', {
      job_id: id,
      owner: await profile,
      scope: bound.scope,
      source_generation: bound.sourceGeneration,
      request: { action: 'selection' },
    })) as Selection | null;
    premiumAuthorizations.consume(message.token, tabId, selection);
    if (selection?.account.origin !== new URL(page).origin) throw Error('account_premium_stale');
  }

  const job = (await browserSnapshot()).jobs.find((job: any) => job.id === id);
  if (!job || !['waiting_browser', 'waiting_user'].includes(job.state))
    throw Error('navigation_authorization_stale');
  await verifyStreamOwner(id, tabId, bound.scope, bound.sourceGeneration);
  await native('navigation_selection', {
    id,
    owner: await profile,
    scope: bound.scope,
    source_generation: bound.sourceGeneration,
    page,
    selected_host: action.selectedHost ?? null,
    adapter: { id: bound.adapterId, version: bound.adapterVersion },
  });
  committedAuthorizations.set(message.token, tabId);
  if (committedAuthorizations.size > 128)
    committedAuthorizations.delete(committedAuthorizations.keys().next().value!);
  const direct = settings.directCapture
    ? await armDirect(id, record, action, job.filename ?? 'download')
    : false;
  record.steps++;
  record.fingerprint = bound.fingerprint;
  record.clickedAt = Date.now();
  record.request = action;
  await navigationStore.set({ [entry[0]]: record });
  return { click: !direct, direct, repeat: true };
}
async function resolverStep(message: any, tabId: number, currentUrl: string, documentId?: string) {
  return captureTransitions.run(tabId, () =>
    resolverStepSerialized(message, tabId, currentUrl, documentId),
  );
}
async function resolverStepSerialized(
  message: any,
  tabId: number,
  currentUrl: string,
  documentId?: string,
) {
  const snapshot = await browserSnapshot();
  const storage: Record<string, any> = await navigationStore.get(null);
  const entry = Object.entries(storage).find(
    ([key, r]) => key.startsWith('resolver-') && r.tabId === tabId,
  );
  if (!entry || message.url !== currentUrl) return { click: false, repeat: false };
  const id = entry[0].slice(9),
    record = entry[1] as ResolverRecord,
    job = snapshot.jobs.find((j: any) => j.id === id);
  if (!job || !['waiting_browser', 'waiting_user'].includes(job.state) || record.downloadId)
    return { click: false, repeat: false };
  if (record.scope && directOwners.owns(tabId, id, record.scope, record.sourceGeneration!))
    return { click: false, repeat: false };
  const capture = storage['capture-' + id];
  if (interruptedCaptureMatches(capture, record)) return { click: false, repeat: false };
  await applyServerWait(id, record, documentId);
  record.lastOrigin = new URL(currentUrl).origin;
  let premiumSelection: Selection | null = null;
  if (message.premium === true) {
    if (!record.scope || !record.sourceGeneration) return { click: false, repeat: false };
    const selection = (await native('browser_account', {
      job_id: id,
      owner: await profile,
      scope: record.scope,
      source_generation: record.sourceGeneration,
      request: { action: 'selection' },
    })) as Selection | null;
    if (
      !accountDecision(selection).premium ||
      selection?.account.origin !== new URL(currentUrl).origin
    )
      return { click: false, repeat: false };
    premiumSelection = selection;
  }

  if (record.scope) {
    if (record.documentId && record.documentId !== documentId)
      return { click: false, repeat: false };
    const binding = message.binding;
    if (
      !binding ||
      binding.tabId !== tabId ||
      binding.frameId !== 0 ||
      binding.page !== currentUrl ||
      binding.sessionKey !== sessionKey(record.scope) ||
      binding.claimGeneration !== record.scope.claim_generation ||
      binding.sourceGeneration !== record.sourceGeneration ||
      binding.documentNonce !== record.documentNonce ||
      !Number.isSafeInteger(binding.documentGeneration) ||
      binding.documentGeneration < (record.documentGeneration ?? 0)
    )
      return { click: false, repeat: false };
    record.documentGeneration = binding.documentGeneration;
  }
  const decision = message.decision;
  if (
    job.request_id?.startsWith('discovery-') &&
    decision?.kind === 'click' &&
    message.request?.url !== job.url
  )
    return { click: false, repeat: false };
  if (!['wait', 'user', 'click'].includes(decision?.kind))
    throw Error('Invalid navigation decision');
  if (
    shouldSolve(
      decision.blocker,
      snapshot.solver_enabled === true,
      snapshot.solver_direct === true,
      job.solver_attempted === true,
      job.private === true,
    )
  ) {
    await native('browser_status', {
      id,
      state: 'waiting_user',
      url: currentUrl,
      message: 'Browser challenge detected.',
      bytes: 0,
      total: null,
    });
    try {
      await native('solve_challenge', { id, url: currentUrl, automatic: true });
      return { click: false, repeat: false };
    } catch (error) {
      if (String(error).includes('solver_busy')) return { click: false, repeat: true };
      await reportError(error);
      return { click: false, repeat: false };
    }
  }
  await scheduler.heartbeat(id, tabId);
  const admission = await scheduler.request({
    action: 'validate',
    id,
    generation: record.generation ?? 1,
  });
  if (admission.tasks.find((task) => task.id === id)?.status === 'manual')
    return { click: false, repeat: false };
  if (decision.kind === 'wait' && (decision.blocker === 'countdown' || decision.wait)) {
    const duration = Number(decision.wait?.duration_ms ?? 30000);
    record.wait = observeWait(
      record.wait,
      record.generation ?? 1,
      duration,
      Date.now(),
      await waitFingerprint(String(decision.wait?.fingerprint ?? 'countdown')),
    );
    const expiry = Number(decision.wait?.expires_at_ms);
    if (Number.isSafeInteger(expiry) && expiry > 0) record.wait.expires_at_ms = expiry;
    record.waitStarted ??= Date.now();
    await scheduler.wait(id, record.wait);
    await navigationStore.set({ [entry[0]]: record });
    await native('browser_status', {
      id,
      url: currentUrl,
      state: 'waiting_browser',
      message: 'Waiting for server readiness; the owning tab remains open.',
      bytes: 0,
      total: null,
    });
    return { click: false, repeat: false };
  }
  if (record.wait) {
    // A fresh page decision is the readiness observation. Expired tokens and
    // stale sessions cannot be made ready by a locally elapsed deadline.
    if (decision.kind === 'user') {
      await scheduler.request({ action: 'manual', id, generation: record.generation ?? 1 });
      await native('browser_status', {
        id,
        url: currentUrl,
        state: 'waiting_user',
        message: String(decision.reason).slice(0, 1024),
        bytes: 0,
        total: null,
      });
      return { click: false, repeat: false };
    }
    if (!(await scheduler.readiness(id, decision.kind === 'click')))
      return { click: false, repeat: true };
    record.waitedMs =
      (record.waitedMs ?? 0) + Math.max(0, Date.now() - (record.waitStarted ?? Date.now()));
    delete record.wait;
    delete record.waitStarted;
    await navigationStore.set({ [entry[0]]: record });
  }
  const repeated =
    record.fingerprint === message.fingerprint && Date.now() - (record.clickedAt ?? 0) < 15000;
  if (
    record.steps >= 12 ||
    Date.now() - record.started - (record.waitedMs ?? 0) > 10 * 60 * 1000 ||
    decision.kind === 'user'
  ) {
    await native('browser_status', {
      id,
      url: currentUrl,
      state: 'waiting_user',
      message: String(
        decision.reason || 'Automatic navigation limit reached. Continue in the browser.',
      ),
      bytes: 0,
      total: null,
    });
    return { click: false, repeat: false };
  }
  if (decision.kind === 'click' && !repeated) {
    const bound = authorizationBinding(message, record, tabId, currentUrl, documentId);
    await native('browser_status', {
      id,
      state: 'waiting_browser',
      url: currentUrl,
      message: String(decision.reason).slice(0, 1024),
      bytes: 0,
      total: null,
    });
    const token = navigationAuthorizations.issue(bound, {
      ...message.request,
      selectedHost: message.selected_host ?? null,
    });
    if (premiumSelection) premiumAuthorizations.issue(token, tabId, premiumSelection);
    await navigationStore.set({ [entry[0]]: record });
    return { authorization: token, click: false, repeat: false };
  }
  await native('browser_status', {
    id,
    url: currentUrl,
    state: 'waiting_browser',
    message: String(decision.reason).slice(0, 1024),
    bytes: 0,
    total: null,
  });
  return { click: decision.kind === 'click' && !repeated, repeat: true };
}
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') void discovery.loaded(tabId).catch(() => {});

  if (change.status === 'loading') {
    navigationAuthorizations.invalidateTab(tabId);
    premiumAuthorizations.invalidateTab(tabId);
  }
  if (change.status === 'loading')
    void (async () => {
      const records = await navigationStore.get(null);
      for (const [key, value] of Object.entries(records)) {
        const record = value as ResolverRecord;
        if (key.startsWith('resolver-') && record.tabId === tabId) {
          const id = key.slice(9);
          const capture = records['capture-' + id];
          if (
            capture?.kind === 'blob' &&
            capture.scope &&
            record.scope &&
            sameScope(capture.scope, record.scope) &&
            capture.sourceGeneration === record.sourceGeneration &&
            ['armed', 'streaming'].includes(capture.state)
          ) {
            await captureCancels.get(tabId)?.();
            captureCancels.delete(tabId);
            await native('browser_status', {
              id,
              state: 'waiting_user',
              message:
                'browser_document_replaced: request a fresh Blob action in the owning browser',
              bytes: 0,
              total: null,
            }).catch(() => {});
          }
          record.documentGeneration = 0;
          delete record.documentId;
          delete record.documentNonce;
          delete record.fingerprint;
          await navigationStore.set({ [key]: record });
        }
      }
    })().catch(() => {});
  if (change.url)
    void (async () => {
      const storage = await navigationStore.get(null);
      const entry = Object.entries(storage).find(
        ([key, r]) => key.startsWith('resolver-') && (r as ResolverRecord).tabId === tabId,
      );
      if (!entry) return;
      const id = entry[0].slice(9);
      const job = (await browserSnapshot()).jobs.find((j: any) => j.id === id);
      if (job?.state === 'solving_challenge')
        await native('browser_status', {
          id,
          url: change.url,
          state: 'waiting_user',
          message: 'Page changed during challenge resolution.',
          bytes: 0,
          total: null,
        });
    })().catch(() => {});
  if (change.status === 'complete')
    void (async () => {
      if (BROWSER === 'firefox') {
        const tab = await browser.tabs.get(tabId);
        if (
          tab.url &&
          /^https?:\/\//.test(tab.url) &&
          (await browser.permissions.contains({ origins: [sitePattern(tab.url)] }))
        ) {
          await browser.tabs
            .executeScript(tabId, { file: 'content.js', runAt: 'document_idle' })
            .catch(() => {});
        }
      }
      const storage: Record<string, any> = await navigationStore.get(null);
      if (
        Object.entries(storage).some(
          ([key, r]) => key.startsWith('resolver-') && r.tabId === tabId && !r.downloadId,
        )
      )
        await injectResolver(tabId);
    })().catch(() => {});
});
browser.tabs.onRemoved.addListener(
  (tabId) =>
    void (async () => {
      navigationAuthorizations.invalidateTab(tabId);
      premiumAuthorizations.invalidateTab(tabId);
      await captureCancels.get(tabId)?.();
      captureCancels.delete(tabId);
      await clearServerResponse(tabId);
      for (const [key, r] of requests) if (r.tabId === tabId) requests.delete(key);
      const storage: Record<string, any> = await navigationStore.get(null);
      for (const [key, r] of Object.entries(storage)) {
        if (
          key.startsWith('resolver-') &&
          r.tabId === tabId &&
          r.sessionEpoch === (await browserEpoch)
        ) {
          if (!r.downloadId)
            await native('browser_status', {
              id: key.slice(9),
              state: 'waiting_user',
              message: 'Navigation tab was closed. Continue page navigation from the extension.',
              bytes: 0,
              total: null,
            }).catch(() => {});
          await navigationStore.remove(key);
        }
      }
    })(),
);
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'resolver-poll') {
    void discovery.poll();
    void pollResolvers();
  }
  if (alarm.name.startsWith(WAIT_ALARM_PREFIX)) void scheduler.onAlarm(alarm.name).catch(() => {});
});

async function browserSnapshot(): Promise<any> {
  if (eventPoll) return eventPoll;
  eventPoll = (async () => {
    if (!eventSnapshot) await native('negotiate', { minimum: 1, maximum: 1 });
    const batch = await native('subscribe', {
      after_sequence: eventSnapshot?.sequence ?? null,
      limit: 50,
    });
    eventSnapshot = applyEvents(eventSnapshot, batch);
    if (!eventSnapshot)
      eventSnapshot = (await native('subscribe', { after_sequence: null, limit: 50 })).snapshot;
    return eventSnapshot;
  })();
  try {
    return await eventPoll;
  } catch (e) {
    eventSnapshot = null;
    throw e;
  } finally {
    eventPoll = null;
  }
}

async function resolverAccount(
  message: { request: AccountAction; binding: AccountBinding; document: DocumentClaim },
  tabId: number,
  frameId: number,
  documentId?: string,
) {
  if (
    message.document?.nonce !== message.binding?.documentNonce ||
    message.document?.generation !== message.binding?.documentGeneration
  )
    throw Error('account_document_stale');
  const currentPage = await validateAccountDocument(
    browser,
    BROWSER,
    tabId,
    documentId,
    message.document,
  );
  const ctx = await resolverContext(tabId, frameId, documentId, message.document);
  if (!ctx || !ctx.sourceGeneration || !message.binding || frameId !== 0)
    throw Error('account_binding_stale');
  const records = await navigationStore.get(null);
  const entry = Object.entries(records).find(
    ([key, value]: any) => key.startsWith('resolver-') && value.tabId === tabId,
  );
  if (!entry) throw Error('account_owned_tab_required');
  const record = entry[1] as ResolverRecord;
  if (
    !Number.isSafeInteger(message.binding.documentGeneration) ||
    message.binding.documentGeneration < 1 ||
    message.binding.documentGeneration < (record.documentGeneration ?? 0) ||
    (message.request.action === 'consume' &&
      message.binding.documentGeneration !== record.documentGeneration)
  )
    throw Error('account_document_stale');
  const owned = {
    jobId: entry[0].slice(9),
    owner: await profile,
    scope: ctx.scope,
    sourceGeneration: ctx.sourceGeneration,
    tabId,
    frameId,
    documentId: ctx.documentId ?? null,
    documentNonce: ctx.documentNonce,
    page: currentPage,
  };
  validateAccountRequest(message.request, message.binding, owned);
  record.documentGeneration = message.binding.documentGeneration;
  await navigationStore.set({ [entry[0]]: record });
  const tab = await browser.tabs.get(tabId);
  if (!tab.url || tab.status !== 'complete' || Boolean(tab.incognito) !== privateWorker)
    throw Error('account_owned_tab_required');
  return accountRequest(message.request, message.binding, owned, native);
}
async function resolverContext(
  tabId: number,
  frameId: number,
  documentId?: string,
  document?: DocumentClaim,
) {
  if (frameId !== 0 || (await browser.tabs.get(tabId)).status !== 'complete') return null;
  if (
    BROWSER === 'chromium' &&
    !(await browser.permissions.contains({ permissions: ['webNavigation'] }))
  )
    return null;
  const snapshot = await browserSnapshot();
  const records = await navigationStore.get(null);
  const entry = Object.entries(records).find(
    ([key, value]: any) => key.startsWith('resolver-') && value.tabId === tabId,
  );
  if (!entry) return null;
  const record = entry[1] as ResolverRecord;
  if (record.sessionEpoch !== (await browserEpoch)) return null;
  const job = snapshot.jobs.find((job: any) => job.id === entry[0].slice(9));
  if (
    !job ||
    !record.scope ||
    !sameScope(record.scope, job.navigation_scope) ||
    ['cancelled', 'complete', 'failed'].includes(job.state)
  )
    return null;
  const current = await scopeForTab(
    browser as any,
    BROWSER,
    await profile,
    tabId,
    record.scope.claim_generation,
    frameId,
  );
  if (!sameScope(current, record.scope)) return null;
  if (!document) return null;
  const live = await verifyLiveDocument(browser, BROWSER, tabId, document, documentId);
  if (!live) return null;
  if (record.documentNonce === live.nonce && document.generation < (record.documentGeneration ?? 0))
    return null;
  if (record.documentNonce !== live.nonce) {
    navigationAuthorizations.invalidateTab(tabId);
    premiumAuthorizations.invalidateTab(tabId);
  }
  record.documentNonce = live.nonce;
  record.documentGeneration = document.generation;
  if (
    !Number.isSafeInteger(record.sourceGeneration) ||
    record.sourceGeneration! < 1 ||
    record.sourceGeneration !== job.source_generation
  )
    return null;
  record.documentId = live.documentId ?? documentId;
  await navigationStore.set({ [entry[0]]: record });
  return {
    tabId,
    frameId,
    scope: record.scope,
    sourceGeneration: record.sourceGeneration!,
    documentId: record.documentId,
    documentGeneration: document.generation,
    documentNonce: live.nonce,
    selectedHost: job.selected_host,
    selectedResource: job.request_id?.startsWith('discovery-') ? job.url : undefined,
    disabledAdapters: settings.disabledAdapters ?? [],
    locale: settings.locale,
    capabilities: { pageBlob: settings.directCapture },
  };
}

async function reportError(error: unknown, privateSession = privateWorker) {
  if (privateSession) {
    if (browser.storage.session)
      await browser.storage.session.set({
        lastError: 'Private browser operation failed; inspect the current owned task.',
      });
    return;
  }
  await browser.storage.local.set({ lastError: String(error) });
}

const challengeAuthorizations = new Set<string>();
async function challengeMessage(message: any, sender: browser.Runtime.MessageSender) {
  const tabId = sender.tab?.id,
    frameId = sender.frameId ?? 0,
    documentId = (sender as any).documentId;
  if (tabId === undefined || frameId !== 0 || !message.document)
    throw Error('challenge_session_rejected');
  async function recordForTab() {
    const records = await navigationStore.get(null);
    const row = Object.entries(records).find(
      ([key, value]: any) => key.startsWith('resolver-') && value.tabId === tabId,
    );
    return row ? { id: row[0].slice(9), record: row[1] as ResolverRecord } : null;
  }
  async function owned() {
    const ctx = await resolverContext(tabId!, frameId, documentId, message.document);
    const current = await browser.tabs.get(tabId!);
    if (
      !ctx ||
      !Number.isSafeInteger(ctx.sourceGeneration) ||
      !current.url ||
      current.url !== sender.url
    )
      return null;
    return { ...ctx, page: current.url, selectedHost: ctx.selectedHost ?? '' };
  }
  const ctx = await owned(),
    row = await recordForTab();
  if (!ctx || !row) throw Error('challenge_session_rejected');
  const authorizeSite = async () => {
    if (!(await scheduler.admitted(row.id))) return false;
    await scheduler.heartbeat(row.id, tabId!);
    if (!(await owned())) return false;
    await native('browser_status', {
      id: row.id,
      state: 'waiting_user',
      url: ctx.page,
      message: 'Image challenge requires an answer in the owning browser tab.',
      bytes: 0,
      total: null,
    });
    return true;
  };
  if (message.type === 'resolver_challenge_select') {
    if (
      !['g4u.to', 'ddownload.com', 'rapidgator.net', 'gofile.io'].includes(message.selectedHost) ||
      !(await authorizeSite())
    )
      throw Error('challenge_host_rejected');
    const fresh = await owned();
    if (!fresh) throw Error('challenge_session_rejected');
    const adapter = matchAdapter(fresh.page, settings.disabledAdapters);
    await native('navigation_selection', {
      id: row.id,
      owner: fresh.scope.profile,
      scope: fresh.scope,
      source_generation: fresh.sourceGeneration,
      page: fresh.page,
      selected_host: message.selectedHost,
      adapter: { id: adapter.id, version: adapter.version },
    });
    eventSnapshot = null;
    return true;
  }
  if (
    !message.binding ||
    message.binding.documentGeneration !== message.document.generation ||
    message.binding.documentNonce !== message.document.nonce
  )
    throw Error('challenge_session_rejected');
  const handler = challengeHandler(
    {
      owned: async () => owned(),
      authorizeSite,
      jobId: async () => row.id,
      native: async (args) => native('captcha', args),
      now: () => Date.now(),
    },
    challengeAuthorizations,
  );
  const identity = { tabId, frameId, page: sender.url ?? '' };
  if (message.type === 'resolver_challenge_authorize')
    return handler.authorize(identity, message.binding);
  return handler.paid(identity, message.binding, { action: message.action, image: message.image });
}
