import { applyEvents } from '../../../packages/shared/src/events';
import browser from 'webextension-polyfill';
import { shouldSolve } from './resolver-policy';
import { NavigationScheduler, WAIT_ALARM_PREFIX } from './navigation/scheduler/runtime';
import { observeWait, waitFingerprint, type DurableWait } from './navigation/scheduler/waits';
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
  request => native('navigation_scheduler', { request }),
  async id => {
    const storage = await browser.storage.local.get('resolver-' + id);
    const record = storage['resolver-' + id] as ResolverRecord | undefined;
    if (record) {
      await scheduler.heartbeat(id, record.tabId);
      await browser.tabs.sendMessage(record.tabId, { type: 'resolver_continue' }).catch(() => injectResolver(record.tabId));
    }
  },
);
let schedulerRecovered = false;
const resolverSteps = new Map<number, Promise<unknown>>();
const profile = browser.storage.local.get('profileId').then(async (stored) => {
  const id = typeof stored.profileId === 'string' ? stored.profileId : crypto.randomUUID();
  if (!stored.profileId) await browser.storage.local.set({ profileId: id });
  return id;
});
const requests = new Map<
  string,
  {
    method: string;
    headers: Record<string, string>;
    tabId: number;
    time: number;
  }
>();
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
  await pollResolvers();
}
async function native(command: string, args?: unknown): Promise<any> {
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
    const record = (await browser.storage.local.get('resolver-' + (args as any).request.id))['resolver-' + (args as any).request.id] as ResolverRecord | undefined;
    if (record?.scope) args = { ...(args as object), scope: record.scope };
  }
  if (['add', 'navigate'].includes(command))
    args = { ...(args as any), context: { ...(args as any)?.context, profile: await profile } };
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
  const observe = (details: any) => {
    const headers: Record<string, string> = {};
    for (const h of details.requestHeaders ?? []) {
      if (
        ['referer', 'origin', 'user-agent', 'accept'].includes(h.name.toLowerCase()) &&
        h.value &&
        !/[\r\n]/.test(h.value)
      )
        headers[h.name] = h.value;
    }
    requests.set(details.url, {
      method: details.method,
      headers,
      tabId: details.tabId,
      time: Date.now(),
    });
    // MV3 workers can restart between the network and download events.
    // Session storage retains ephemeral request context without writing it to disk.
    if (browser.storage.session) {
      void browser.storage.session
        .set({ ['request-' + details.url]: requests.get(details.url) })
        .catch(() => {});
    }
    for (const [url, record] of requests)
      if (Date.now() - record.time > 120000) requests.delete(url);
  };
  browser.webRequest.onBeforeRequest.addListener(observe, {
    urls: ['http://*/*', 'https://*/*'],
  });
  browser.webRequest.onBeforeSendHeaders.addListener(
    observe,
    { urls: ['http://*/*', 'https://*/*'] },
    ['requestHeaders'],
  );
  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      const type =
        details.responseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
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
  observerInstalled = true;
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
  const record = requests.get(url);
  const headers = { ...record?.headers };
  if (
    await browser.permissions.contains({
      permissions: ['cookies'],
      origins: [sitePattern(url)],
    })
  ) {
    try {
      const stores = await browser.cookies.getAllCookieStores();
      const store =
        record?.tabId !== undefined
          ? stores.find((s) => s.tabIds.includes(record.tabId))
          : undefined;
      const details: any = { url, ...(store ? { storeId: store.id } : {}) };
      const unpartitioned = (await browser.cookies.getAll(details)).filter(
        (c) => !(c as any).partitionKey,
      );
      // Chromium partitioning is keyed to the top-level document; never mix stores.
      if (record && BROWSER === 'chromium') {
        try {
          const c = browser.cookies as any;
          const partition = await c.getPartitionKey?.({
            tabId: record.tabId,
            frameId: 0,
          });
          if (partition?.partitionKey) details.partitionKey = partition.partitionKey;
        } catch {}
      }
      const cookies = details.partitionKey
        ? [...unpartitioned, ...(await browser.cookies.getAll(details))]
        : unpartitioned;
      if (cookies.length) headers.Cookie = cookies.map((c) => c.name + '=' + c.value).join('; ');
    } catch {}
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
  let record = requests.get(download.finalUrl || item.url) ?? requests.get(item.url);
  if (!record && browser.storage.session) {
    const key = 'request-' + (download.finalUrl || item.url);
    const stored = await browser.storage.session.get(key);
    const value = stored[key] as
      { method: string; headers: Record<string, string>; tabId: number; time: number } | undefined;
    if (value && Date.now() - value.time < 120000) {
      record = value;
      requests.set(download.finalUrl || item.url, value);
    }
  }
  if (!record && resolverId) {
    const stored = await browser.storage.local.get('resolver-' + resolverId);
    const resolver = stored['resolver-' + resolverId] as ResolverRecord | undefined;
    if (resolver?.request?.method === 'GET' && resolver.request.url === item.url) {
      record = {
        method: 'GET',
        headers: item.referrer ? { Referer: item.referrer } : {},
        tabId: resolver.tabId,
        time: Date.now(),
      };
      requests.set(download.finalUrl || item.url, record!);
    }
  }
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
    record?.method === 'GET' && /^https?:\/\//.test((item as Download).finalUrl || item.url);
  if (resolverId && (!replayable || item.state === 'complete')) {
    await browser.storage.local.set({ ['browser-job-' + item.id]: resolverId });
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
  if (!resolverId && !eligible(download, settings, record?.method)) return;
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
        await browser.storage.local.set({
          ['browser-job-' + item.id]: resolverId,
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
      if (value) await browser.storage.local.set({ [key]: value });
      else await browser.storage.local.remove(key);
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
    .then(async (outcome) => {
      if (resolverId && outcome === 'browser') {
        const [current] = await browser.downloads.search({ id: item.id });
        if (current) {
          await browser.storage.local.set({ ['browser-job-' + item.id]: resolverId });
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
      await browser.storage.local.set({ lastError: String(e) });
    })
    .finally(() => ongoing.delete(item.id));
}
browser.downloads.onCreated.addListener(
  (item) =>
    void resolveDownload(item).catch((e) => browser.storage.local.set({ lastError: String(e) })),
);
async function resolveDownload(item: browser.Downloads.DownloadItem) {
  const tabId =
    (item as any).tabId ??
    requests.get((item as Download).finalUrl || item.url)?.tabId ??
    requests.get(item.url)?.tabId;
  const stored: Record<string, any> = await browser.storage.local.get(null);
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
    await browser.storage.local.set({
      [entry[0]]: { ...entry[1], downloadId: item.id },
    });
    await capture(item, id);
  } else await capture(item);
}
browser.downloads.onChanged.addListener(
  (delta) =>
    void (async () => {
      const key = 'browser-job-' + delta.id,
        record: Record<string, any> = await browser.storage.local.get(key);
      const [item] = await browser.downloads.search({ id: delta.id });
      if (!item) return;
      if (record[key]) {
        await native('browser_status', {
          id: record[key],
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
        if (item.state !== 'in_progress') await browser.storage.local.remove(key);
      } else if (delta.filename) await resolveDownload(item);
    })().catch(() => {}),
);
async function recover() {
  const storage: Record<string, any> = await browser.storage.local.get(null);
  for (const [key, value] of Object.entries(storage)) {
    if (!key.startsWith('pending-') || !value) continue;
    const p = value as any;
    try {
      const snap = await browserSnapshot();
      const job = snap.jobs.find((j: any) => j.id === p.jobId || j.request_id === p.requestId);
      if (job && (job.viable || job.state === 'complete'))
        await browser.downloads.cancel(p.downloadId);
      else {
        if (job) await native('cancel', { id: job.id });
        await browser.downloads.resume(p.downloadId);
      }
      await browser.storage.local.remove(key);
    } catch {
      try {
        await browser.downloads.resume(p.downloadId);
        await browser.storage.local.remove(key);
      } catch {}
    }
  }
}
browser.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    if (info.menuItemId === 'navigate') {
      const url = info.linkUrl || tab?.url;
      if (url && (await navigationPermissions(url))) {
        const job = await native('navigate', {
          request_id: crypto.randomUUID(),
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
        await startResolver(job);
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
  })().catch((e) => browser.storage.local.set({ lastError: String(e) }));
});
browser.runtime.onMessage.addListener((message: any, sender: browser.Runtime.MessageSender) => {
  if (sender.id !== browser.runtime.id) return Promise.reject(Error('Unknown message sender'));
  const extensionPage =
    sender.url === browser.runtime.getURL('options.html') ||
    sender.url === browser.runtime.getURL('popup.html');
  if (sender.tab && !extensionPage) {
    if (message.type === 'resolver_step')
      {
        const tabId = sender.tab.id!;
        const work = (resolverSteps.get(tabId) ?? Promise.resolve()).catch(() => {}).then(() => resolverStep(message, tabId, sender.tab!.url ?? ''));
        resolverSteps.set(tabId, work);
        void work.finally(() => {if (resolverSteps.get(tabId) === work) resolverSteps.delete(tabId);}).catch(() => {});
        return work;
      }
    if (message.type !== 'download_media')
      return Promise.reject(Error('Content scripts cannot control the native host'));
  }
  if (extensionPage && message.type === 'navigation_scheduler') return scheduler.request(message.request);
  if (extensionPage && message.type === 'navigation_queue_cancel') return (async () => {
    await native('cancel', { id: message.id });
    await scheduler.release(message.id);
    const storage = await browser.storage.local.get('resolver-' + message.id);
    const record = storage['resolver-' + message.id] as ResolverRecord | undefined;
    await browser.storage.local.remove('resolver-' + message.id);
    if (record) await browser.tabs.remove(record.tabId).catch(() => {});
    await pollResolvers();
    return true;
  })();
  if (extensionPage && message.type === 'navigation_queue_continue') return (async () => {
    const job = (await browserSnapshot()).jobs.find((j: any) => j.id === message.id);
    if (!job?.page_url) throw Error('Navigation task unavailable');
    if (!(await navigationPermissions(job.page_url))) throw Error('Site permission required');
    const record = (await browser.storage.local.get('resolver-' + job.id))['resolver-' + job.id] as ResolverRecord | undefined;
    const state = await scheduler.request({ action: 'snapshot' });
    if (record?.wait && state.tasks.find(task => task.id === job.id)?.status === 'waiting') await scheduler.observe(job.id);
    else {
      if (record) {delete record.wait;delete record.waitStarted;await browser.storage.local.set({ ['resolver-' + job.id]: record });}
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
      return native('resume', { id: job.id, restart: false });
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
  tabId: number;
  started: number;
  steps: number;
  fingerprint?: string;
  clickedAt?: number;
  downloadId?: number;
  request?: { method: string; url: string };
  wait?: DurableWait;
  waitStarted?: number;
  waitedMs?: number;
  generation?: number;
  lastOrigin?: string;
  private?: boolean;
  scope?: import('../../../packages/shared/src/navigation').SessionScope;
};
async function navigationPermissions(url: string) {
  return browser.permissions.request({
    permissions: [
      'webRequest',
      'cookies',
      ...(BROWSER === 'chromium' ? ['scripting' as const] : []),
    ],
    origins: [sitePattern(url)],
  });
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
async function startResolver(job: any, force = false) {
  if (!/^https?:\/\//.test(job.page_url)) throw Error('Page navigation requires HTTP or HTTPS');
  if (force) await scheduler.request({ action: 'control', id: job.id, paused: false, priority: null });
  if (!(await scheduler.admitted(job.id))) return;
  await native('claim_navigation', { id: job.id, force });
  const key = 'resolver-' + job.id,
    stored = await browser.storage.local.get(key);
  if (stored[key]) {
    const record = stored[key] as ResolverRecord;
    try {
      await browser.tabs.get(record.tabId);
      await scheduler.heartbeat(job.id, record.tabId);
      await browser.tabs.update(record.tabId, { active: true });
      record.started = Date.now();
      record.steps = 0;
      await browser.storage.local.set({ [key]: record });
      await browser.tabs.sendMessage(record.tabId, { type: 'resolver_continue' }).catch(() => injectResolver(record.tabId));
      return;
    } catch {
      await browser.storage.local.remove(key);
    }
  }
  const tab = await browser.tabs.create({ url: job.page_url, active: true });
  await scheduler.heartbeat(job.id, tab.id!);
  await browser.storage.local.set({
    [key]: {
      tabId: tab.id!,
      started: Date.now(),
      steps: 0,
      generation: 1,
      lastOrigin: new URL(job.page_url).origin,
      private: job.private ?? false,
    } satisfies ResolverRecord,
  });
  await native('browser_status', {
    id: job.id,
    state: 'waiting_browser',
    message: 'Following the free download steps in the browser.',
    bytes: 0,
    total: null,
  });
  if (tab.status === 'complete') await injectResolver(tab.id!);
}
let polling = false;
async function pollResolvers(userGesture = false) {
  if (polling) return;
  polling = true;
  try {
    const snapshot = await browserSnapshot();
    const storage: Record<string, any> = await browser.storage.local.get(null);
    if (!schedulerRecovered) {
      await scheduler.reconcile(Object.entries(storage).filter(([key]) => key.startsWith('resolver-')).map(([key, record]) => ({ id: key.slice(9), tabId: record.tabId, origin: record.lastOrigin, private: record.private, cookieStoreId: record.scope?.cookie_store_id, scope: record.scope })));
      schedulerRecovered = true;
    }
    const active: any[] = [];
    for (const [key, record] of Object.entries(storage)) {
      if (!key.startsWith('resolver-')) continue;
      const job = snapshot.jobs.find((job: any) => job.id === key.slice(9));
      if (!job || ['complete', 'browser_complete', 'cancelled', 'failed'].includes(job.state)) {
        await scheduler.release(key.slice(9));
        await browser.storage.local.remove(key);
        await browser.tabs.remove(record.tabId).catch(() => {});
      } else {
        const tab = await browser.tabs.get(record.tabId).catch(() => null);
        if (tab) {
          await scheduler.heartbeat(job.id, record.tabId);
          if (record.wait) await scheduler.observe(job.id);
        }
        else {
          await browser.storage.local.remove(key);
          await scheduler.reconcile(Object.entries(storage).filter(([otherKey]) => otherKey.startsWith('resolver-') && otherKey !== key).map(([otherKey, r]) => ({ id: otherKey.slice(9), tabId: r.tabId, scope: r.scope, origin: r.lastOrigin, private: r.private, cookieStoreId: r.scope?.cookie_store_id })));
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
        origins: [sitePattern(job.page_url)],
      });
      if (!allowed) {
        continue;
      }
      const stored: Record<string, any> = await browser.storage.local.get('resolver-' + job.id);
      if (!stored['resolver-' + job.id]) {
        // Admission is atomic in the service; workers cannot race tab limits.
        if (!(await scheduler.admitted(job.id))) continue;
        try {
          await startResolver(job, userGesture);
          active.push(job);
        } catch {}
      } else if (userGesture) await startResolver(job, true).catch(() => {});
    }
  } catch {
  } finally {
    polling = false;
  }
}
async function resolverStep(message: any, tabId: number, currentUrl: string) {
  const storage: Record<string, any> = await browser.storage.local.get(null);
  const entry = Object.entries(storage).find(
    ([key, r]) => key.startsWith('resolver-') && r.tabId === tabId,
  );
  if (!entry || message.url !== currentUrl) return { click: false, repeat: false };
  const id = entry[0].slice(9),
    record = entry[1] as ResolverRecord,
    snapshot = await browserSnapshot(),
    job = snapshot.jobs.find((j: any) => j.id === id);
  if (!job || !['waiting_browser', 'waiting_user'].includes(job.state) || record.downloadId)
    return { click: false, repeat: false };
  record.lastOrigin = new URL(currentUrl).origin;
  const decision = message.decision;
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
      await browser.storage.local.set({ lastError: String(error) });
      return { click: false, repeat: false };
    }
  }
  await scheduler.heartbeat(id, tabId);
  const admission = await scheduler.request({ action: 'validate', id, generation: record.generation ?? 1 });
  if (admission.tasks.find(task => task.id === id)?.status === 'manual') return { click: false, repeat: false };
  if (decision.kind === 'wait' && (decision.blocker === 'countdown' || decision.wait)) {
    const duration = Number(decision.wait?.duration_ms ?? 30000);
    record.wait = observeWait(record.wait, record.generation ?? 1, duration, Date.now(), await waitFingerprint(String(decision.wait?.fingerprint ?? 'countdown')));
    const expiry = Number(decision.wait?.expires_at_ms);
    if (Number.isSafeInteger(expiry) && expiry > 0) record.wait.expires_at_ms = expiry;
    record.waitStarted ??= Date.now();
    await scheduler.wait(id, record.wait);
    await browser.storage.local.set({ [entry[0]]: record });
    await native('browser_status', { id, url: currentUrl, state: 'waiting_browser', message: 'Waiting for server readiness; the owning tab remains open.', bytes: 0, total: null });
    return { click: false, repeat: false };
  }
  if (record.wait) {
    // A fresh page decision is the readiness observation. Expired tokens and
    // stale sessions cannot be made ready by a locally elapsed deadline.
    if (decision.kind === 'user') {
      await scheduler.request({ action: 'manual', id, generation: record.generation ?? 1 });
      await native('browser_status', { id, url: currentUrl, state: 'waiting_user', message: String(decision.reason).slice(0, 1024), bytes: 0, total: null });
      return { click: false, repeat: false };
    }
    if (!(await scheduler.readiness(id, decision.kind === 'click'))) return { click: false, repeat: true };
    record.waitedMs = (record.waitedMs ?? 0) + Math.max(0, Date.now() - (record.waitStarted ?? Date.now()));
    delete record.wait; delete record.waitStarted;
    await browser.storage.local.set({ [entry[0]]: record });
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
    record.steps++;
    record.fingerprint = String(message.fingerprint).slice(0, 4096);
    record.clickedAt = Date.now();
    const request = message.request;
    if (request && ['GET', 'POST'].includes(request.method) && typeof request.url === 'string') {
      const url = new URL(request.url);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
        record.request = { method: request.method, url: url.href };
    } else delete record.request;
    await browser.storage.local.set({ [entry[0]]: record });
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
  if (change.url)
    void (async () => {
      const storage = await browser.storage.local.get(null);
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
      const storage: Record<string, any> = await browser.storage.local.get(null);
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
      const storage: Record<string, any> = await browser.storage.local.get(null);
      for (const [key, r] of Object.entries(storage)) {
        if (key.startsWith('resolver-') && r.tabId === tabId) {
          await browser.storage.local.remove(key);
          if (!r.downloadId)
            await native('browser_status', {
              id: key.slice(9),
              state: 'waiting_user',
              message: 'Navigation tab was closed. Continue page navigation from the extension.',
              bytes: 0,
              total: null,
            }).catch(() => {});
        }
      }
    })(),
);
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'resolver-poll') void pollResolvers();
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
