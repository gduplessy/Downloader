import browser from 'webextension-polyfill';
import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { scopeForTab, sameScope } from '../session/scope';
declare const BROWSER: string;
type Native = (command: string, args?: unknown) => Promise<any>;
interface RecordState {
  id: string;
  scope: SessionScope;
  generation: number;
  tabId: number;
  page_url: string;
  windowId: number;
  permitted_origins: string[];
}
export class RenderedDiscovery {
  private busy = new Set<string>();
  private records = new Map<string, RecordState>();
  constructor(
    private native: Native,
    private profile: () => Promise<string>,
    private privateWorker: boolean,
  ) {}
  async projects(tabId: number) {
    const scope = await scopeForTab(browser, BROWSER, await this.profile(), tabId, 1);
    if (scope.private !== this.privateWorker)
      throw Error('Discovery belongs to another browser lane');
    return this.native('discovery_list', { scope });
  }
  async start(id: string, tabId: number, permittedOrigins: string[] = []) {
    const tab = await browser.tabs.get(tabId);
    if (!!tab.incognito !== this.privateWorker)
      throw Error('Discovery belongs to another browser lane');
    const scope = await scopeForTab(browser, BROWSER, await this.profile(), tabId, 1);
    const projects = await this.native('discovery_list', { scope });
    const project = projects.find((p: any) => p.id === id);
    if (!project) throw Error('Discovery project unavailable in this session');
    if (new URL(tab.url!).origin !== new URL(project.url).origin)
      throw Error('Open the project page in the selected browser session first');
    if (
      !(await browser.permissions.contains({
        origins: [
          new URL(project.url).origin + '/*',
          ...permittedOrigins.map((origin) => origin + '/*'),
        ],
      }))
    )
      throw Error('Explicit discovery origin permission required');
    const existing = this.records.get(id);
    if (existing) {
      await this.native('discovery_status', {
        id,
        scope: existing.scope,
        generation: existing.generation,
        action: 'resume',
      });
      await this.poll();
      return;
    }
    const claimed = await this.native('discovery_claim', {
      id,
      scope,
      generation: project.generation,
      tab_id: null,
      permitted_origins: permittedOrigins,
    });
    const record: RecordState = {
      id,
      scope,
      generation: project.generation,
      tabId: -1,
      page_url: '',
      windowId: tab.windowId!,
      permitted_origins: permittedOrigins,
    };
    this.records.set(id, record);
    await this.save(record);
    if (claimed.page) await this.open(record, claimed.page.url);
  }
  private async save(record: RecordState) {
    if (record.scope.private) {
      await browser.storage.session?.set({ ['discovery-' + record.id]: record });
    } else await browser.storage.local.set({ ['discovery-' + record.id]: record });
  }
  private async open(record: RecordState, url: string) {
    if (!(await browser.permissions.contains({ origins: [new URL(url).origin + '/*'] })))
      throw Error('Discovery origin permission missing');
    if (record.tabId >= 0) {
      const old = await browser.tabs.get(record.tabId).catch(() => null);
      if (old) await browser.tabs.remove(record.tabId);
    }
    const options: any = { url, active: false, windowId: record.windowId };
    if (BROWSER === 'firefox') options.cookieStoreId = record.scope.cookie_store_id;
    const tab = await browser.tabs.create(options);
    if (!!tab.incognito !== record.scope.private) {
      await browser.tabs.remove(tab.id!);
      throw Error('Discovery privacy mismatch');
    }
    record.tabId = tab.id!;
    record.page_url = url;
    await this.save(record);
    await this.native('discovery_claim', {
      id: record.id,
      scope: record.scope,
      generation: record.generation,
      tab_id: record.tabId,
      permitted_origins: record.permitted_origins,
    });
    if (tab.status === 'complete') await this.loaded(record.tabId);
  }
  async loaded(tabId: number) {
    const record = [...this.records.values()].find((r) => r.tabId === tabId);
    if (!record) return;
    const scope = await scopeForTab(
      browser,
      BROWSER,
      record.scope.profile,
      tabId,
      record.scope.claim_generation,
    );
    if (!sameScope(scope, record.scope)) throw Error('Discovery session changed');
    if (BROWSER === 'chromium')
      await browser.scripting.executeScript({ target: { tabId }, files: ['discovery.js'] });
    else await browser.tabs.executeScript(tabId, { file: 'discovery.js', runAt: 'document_idle' });
  }
  async result(sender: any, result: any) {
    const record = [...this.records.values()].find((r) => r.tabId === sender.tab?.id);
    if (!record || sender.frameId !== 0) throw Error('Unowned discovery document');
    if (this.busy.has(record.id)) return;
    this.busy.add(record.id);
    try {
      const scope = await scopeForTab(
        browser,
        BROWSER,
        record.scope.profile,
        record.tabId,
        record.scope.claim_generation,
      );
      if (
        !sameScope(scope, record.scope) ||
        new URL(sender.url).href !== new URL(result.final_url).href
      )
        throw Error('Stale discovery document scope');
      const status = await this.native('discovery_page_result', {
        id: record.id,
        scope,
        generation: record.generation,
        page_url: record.page_url,
        ...result,
      });
      if (result.reason) {
        await browser.tabs.update(record.tabId, { active: true });
        await this.save(record);
        return;
      }
      await browser.tabs.remove(record.tabId).catch(() => {});
      record.tabId = -1;
      await this.save(record);
      if (status.status === 'exploring') await this.advance(record);
    } finally {
      this.busy.delete(record.id);
    }
  }
  private async advance(record: RecordState) {
    const next = await this.native('discovery_claim', {
      id: record.id,
      scope: record.scope,
      generation: record.generation,
      tab_id: null,
      permitted_origins: record.permitted_origins,
    });
    if (next.page) await this.open(record, next.page.url);
  }
  async liveRecords() {
    const live = [];
    for (const record of this.records.values()) {
      if (record.tabId < 0) continue;
      const state = await this.native('discovery_status', {
        id: record.id,
        scope: record.scope,
        generation: record.generation,
        action: 'snapshot',
      }).catch(() => null);
      if (!state?.lease || state.status !== 'exploring') continue;
      const actual = await scopeForTab(
        browser,
        BROWSER,
        record.scope.profile,
        record.tabId,
        record.scope.claim_generation,
      ).catch(() => null);
      if (actual && sameScope(actual, record.scope))
        live.push({
          id: 'discovery:' + record.id,
          generation: record.generation,
          tab_id: record.tabId,
          scope: record.scope,
        });
    }
    return live;
  }
  async poll() {
    const storage = {
      ...(await browser.storage.local.get(null)),
      ...((await browser.storage.session?.get(null)) ?? {}),
    };
    for (const [key, value] of Object.entries(storage))
      if (
        key.startsWith('discovery-') &&
        (value as RecordState).scope.private === this.privateWorker &&
        (value as RecordState).scope.profile === (await this.profile()) &&
        !this.records.has(key.slice(10))
      )
        this.records.set(key.slice(10), value as RecordState);
    for (const record of this.records.values()) {
      if (this.busy.has(record.id)) continue;
      this.busy.add(record.id);
      try {
        const state = await this.native('discovery_status', {
          id: record.id,
          scope: record.scope,
          generation: record.generation,
          action: 'snapshot',
        });
        if (state.status === 'cancelled') {
          const actual =
            record.tabId >= 0
              ? await scopeForTab(
                  browser,
                  BROWSER,
                  record.scope.profile,
                  record.tabId,
                  record.scope.claim_generation,
                ).catch(() => null)
              : null;
          if (actual && sameScope(actual, record.scope))
            await browser.tabs.remove(record.tabId).catch(() => {});
          this.records.delete(record.id);
          if (record.scope.private) await browser.storage.session?.remove('discovery-' + record.id);
          else await browser.storage.local.remove('discovery-' + record.id);
          continue;
        }
        if (state.selected?.length)
          await this.native('discovery_select', {
            id: record.id,
            scope: record.scope,
            generation: record.generation,
            urls: state.selected,
          });
        if (state.status !== 'exploring') continue;
        const tab =
          record.tabId >= 0 ? await browser.tabs.get(record.tabId).catch(() => null) : null;
        if (!tab) await this.advance(record);
        else {
          await this.native('discovery_claim', {
            id: record.id,
            scope: record.scope,
            generation: record.generation,
            tab_id: record.tabId,
            permitted_origins: record.permitted_origins,
          });
          if (tab.status === 'complete') await this.loaded(record.tabId);
        }
      } catch {
        /* Retain durable frontier; browser absence/session expiry never falls back anonymously. */
      } finally {
        this.busy.delete(record.id);
      }
    }
  }
}
