import { verifyLiveDocument, type DocumentClaim } from '../session/document';
import browser from 'webextension-polyfill';
import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { scopeForTab, sameScope } from '../session/scope';
declare const BROWSER: string;
type Native = (command: string, args?: unknown) => Promise<any>;
interface ResourceSource {
  id: string;
  page_url: string;
  scope: SessionScope;
}
interface Provenance {
  id: string;
  tabId: number;
  scope: SessionScope;
  document: DocumentClaim;
  documentId?: string;
  released?: boolean;
}
interface RecordState {
  id: string;
  scope: SessionScope;
  generation: number;
  tabId: number;
  sourceTabId: number;
  jobs: string[];
  sources?: ResourceSource[];
  provenance?: Provenance;
  page_url: string;
  windowId: number;
  permitted_origins: string[];
  sessionEpoch: string;
}
export class RenderedDiscovery {
  private busy = new Set<string>();
  private records = new Map<string, RecordState>();
  constructor(
    private native: Native,
    private profile: () => Promise<string>,
    private privateWorker: boolean,
    private epoch: () => Promise<string>,
    private startSelected: (id: string, sourceTabId: number) => Promise<boolean>,
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
    let scope = await scopeForTab(browser, BROWSER, await this.profile(), tabId, 1);
    const projects = await this.native('discovery_list', { scope });
    const project = projects.find((p: any) => p.id === id);
    if (!project) throw Error('Discovery project unavailable in this session');
    scope = await scopeForTab(
      browser,
      BROWSER,
      await this.profile(),
      tabId,
      project.claim_generation ? project.claim_generation + 1 : 1,
    );
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
      source_tab_id: tabId,
      observed_url: tab.url,
      resume: !!project.claim_generation,
      permitted_origins: permittedOrigins,
    });
    const record: RecordState = {
      id,
      scope,
      generation: project.generation,
      tabId: -1,
      sourceTabId: tabId,
      jobs: [],
      page_url: '',
      windowId: tab.windowId!,
      permitted_origins: permittedOrigins,
      sessionEpoch: await this.epoch(),
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
    if (!sameScope(scope, record.scope)) {
      const tab = await browser.tabs.get(tabId);
      const proposed = { ...scope, claim_generation: record.scope.claim_generation + 1 };
      await this.native('discovery_claim', {
        id: record.id,
        scope: proposed,
        generation: record.generation,
        tab_id: tabId,
        observed_url: tab.url,
        permitted_origins: record.permitted_origins,
      });
      record.scope = proposed;
      await this.save(record);
    }
    if (BROWSER === 'chromium')
      await browser.scripting.executeScript({ target: { tabId }, files: ['discovery.js'] });
    else await browser.tabs.executeScript(tabId, { file: 'discovery.js', runAt: 'document_idle' });
  }
  async context(sender: any, document: DocumentClaim) {
    const record = [...this.records.values()].find((record) => record.tabId === sender.tab?.id);
    if (!record || sender.frameId !== 0 || record.sessionEpoch !== (await this.epoch()))
      return null;
    const live = await verifyLiveDocument(
      browser,
      BROWSER,
      record.tabId,
      document,
      sender.documentId,
    );
    if (!live) return null;
    const scope = await scopeForTab(
      browser,
      BROWSER,
      record.scope.profile,
      record.tabId,
      record.scope.claim_generation,
    );
    if (!sameScope(scope, record.scope)) return null;
    const claimed = await this.native('discovery_claim', {
      id: record.id,
      scope,
      generation: record.generation,
      tab_id: record.tabId,
      permitted_origins: record.permitted_origins,
      document,
    });
    return { accepted: !!claimed.page };
  }
  async result(sender: any, result: any, document: DocumentClaim) {
    const record = [...this.records.values()].find((r) => r.tabId === sender.tab?.id);
    if (!record || sender.frameId !== 0) throw Error('Unowned discovery document');
    if (!(await verifyLiveDocument(browser, BROWSER, record.tabId, document, sender.documentId)))
      throw Error('Stale discovery document');
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
        document,
        final_url: result.final_url,
        bytes: result.bytes,
        links: result.links,
        reason: result.reason,
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

  private async provenanceScope(
    record: RecordState,
    id: string,
    generation: number,
    proof = record.provenance,
  ) {
    if (!proof || proof.id !== id || record.sessionEpoch !== (await this.epoch())) return null;
    if (
      !(await verifyLiveDocument(browser, BROWSER, proof.tabId, proof.document, proof.documentId))
    )
      return null;
    const actual = await scopeForTab(
      browser,
      BROWSER,
      record.scope.profile,
      proof.tabId,
      generation,
    ).catch(() => null);
    const currentEpoch = await this.epoch();
    return record.provenance === proof && record.sessionEpoch === currentEpoch ? actual : null;
  }
  async scopeForJob(id: string) {
    for (const record of this.records.values()) {
      if (!(record.jobs ?? []).includes(id) || record.sessionEpoch !== (await this.epoch()))
        continue;
      const provenance = record.provenance;
      for (const candidate of [
        record.sourceTabId,
        provenance?.id === id ? provenance.tabId : undefined,
      ]) {
        if (candidate === undefined) continue;
        const actual =
          candidate === record.sourceTabId
            ? await scopeForTab(
                browser,
                BROWSER,
                record.scope.profile,
                candidate,
                record.scope.claim_generation,
              ).catch(() => null)
            : await this.provenanceScope(
                record,
                id,
                provenance!.scope.claim_generation,
                provenance,
              );
        if (!actual) continue;
        const authority = await this.native('navigation_authority', {
          id,
          owner: record.scope.profile,
          scope: actual,
        }).catch(() => null);
        if (!authority?.scope) continue;
        const proof =
          candidate === record.sourceTabId
            ? await scopeForTab(
                browser,
                BROWSER,
                record.scope.profile,
                candidate,
                authority.scope.claim_generation,
              ).catch(() => null)
            : await this.provenanceScope(record, id, authority.scope.claim_generation, provenance);
        if (proof && sameScope(proof, authority.scope)) return authority.scope;
      }
    }
    return null;
  }
  async sourceForJob(job: any) {
    for (const record of this.records.values()) {
      if (
        !(record.jobs ?? []).includes(job.id) ||
        record.sessionEpoch !== (await this.epoch()) ||
        !job.navigation_scope
      )
        continue;
      const provenance = record.provenance;
      for (const tabId of [
        record.sourceTabId,
        provenance && provenance.id === job.id ? provenance.tabId : undefined,
      ]) {
        if (tabId === undefined) continue;
        const actual =
          tabId === record.sourceTabId
            ? await scopeForTab(
                browser,
                BROWSER,
                record.scope.profile,
                tabId,
                job.navigation_scope.claim_generation,
              ).catch(() => null)
            : await this.provenanceScope(
                record,
                job.id,
                job.navigation_scope.claim_generation,
                provenance,
              );
        if (actual && sameScope(actual, job.navigation_scope)) return tabId;
      }
    }
    return undefined;
  }
  async liveScopes() {
    const scopes: SessionScope[] = [];
    for (const record of this.records.values()) {
      if (record.sessionEpoch !== (await this.epoch())) continue;
      const original = await scopeForTab(
        browser,
        BROWSER,
        record.scope.profile,
        record.sourceTabId,
        record.scope.claim_generation,
      ).catch(() => null);
      if (original && sameScope(original, record.scope)) scopes.push(record.scope);
      for (const id of (record.jobs ?? []).slice(0, 64)) {
        const scope = await this.scopeForJob(id);
        if (scope && !scopes.some((existing) => sameScope(existing, scope))) scopes.push(scope);
      }
    }
    return scopes;
  }
  private async prepareSource(
    record: RecordState,
    source: ResourceSource,
  ): Promise<number | undefined> {
    const original = await browser.tabs.get(record.sourceTabId);
    const actual = await scopeForTab(
      browser,
      BROWSER,
      record.scope.profile,
      original.id!,
      source.scope.claim_generation,
    );
    if (sameScope(actual, source.scope)) return original.id!;
    if (
      !(await browser.permissions.contains({ origins: [new URL(source.page_url).origin + '/*'] }))
    )
      throw Error('Approved provenance permission missing');
    const retainedProof = record.provenance;
    const retained = await this.provenanceScope(
      record,
      source.id,
      source.scope.claim_generation,
      retainedProof,
    );
    if (retained && sameScope(retained, source.scope)) return retainedProof!.tabId;
    if (record.provenance) throw Error('Another owned provenance preparation is pending');
    const admitted = await this.native('discovery_prepare', {
      id: record.id,
      job_id: source.id,
      scope: actual,
      generation: record.generation,
      action: 'admit',
      observed_url: original.url,
      tab_id: original.id,
    });
    if (!admitted.admitted) return undefined;
    const tab = await browser.tabs.create({
      url: admitted.page_url,
      active: false,
      windowId: original.windowId,
      ...(BROWSER === 'firefox' ? { cookieStoreId: actual.cookie_store_id! } : {}),
    });
    for (let i = 0; i < 200; i++) {
      if ((await browser.tabs.get(tab.id!)).status === 'complete') break;
      if (i === 199) throw Error('Owned provenance did not settle');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const scope = await scopeForTab(
      browser,
      BROWSER,
      record.scope.profile,
      tab.id!,
      admitted.expected_scope.claim_generation,
    );
    if (!sameScope(scope, admitted.expected_scope) || !!tab.incognito !== record.scope.private) {
      await browser.tabs.remove(tab.id!);
      throw Error('Owned provenance session changed');
    }
    let nonce: string;
    let documentId: string | undefined;
    if (BROWSER === 'chromium') {
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id!, frameIds: [0] },
        func: () => {
          const root = globalThis as typeof globalThis & { __downloaderDocumentNonce?: string };
          return (root.__downloaderDocumentNonce ??= crypto.randomUUID());
        },
      });
      nonce = results[0].result as string;
      documentId = results[0].documentId;
    } else
      nonce = (
        await browser.tabs.executeScript(tab.id!, {
          frameId: 0,
          code: 'globalThis.__downloaderDocumentNonce ??= crypto.randomUUID()',
        })
      )[0] as string;
    const document = { nonce, generation: 1 };
    if (!(await verifyLiveDocument(browser, BROWSER, tab.id!, document, documentId)))
      throw Error('Owned provenance document changed');
    record.provenance = { id: source.id, tabId: tab.id!, scope, document, documentId };
    await this.save(record);
    await this.native('discovery_prepare', {
      id: record.id,
      job_id: source.id,
      scope,
      generation: record.generation,
      action: 'enroll',
      observed_url: source.page_url,
      tab_id: tab.id,
      document,
    });
    await this.native('discovery_prepare', {
      id: record.id,
      job_id: source.id,
      scope,
      generation: record.generation,
      action: 'release',
      observed_url: source.page_url,
      tab_id: tab.id,
      document,
    });
    record.provenance.released = true;
    await this.save(record);
    return tab.id!;
  }
  private async startResource(record: RecordState, source: ResourceSource) {
    const tabId = await this.prepareSource(record, source);
    if (tabId === undefined) return;
    const started = await this.startSelected(source.id, tabId);
    if (!started) return;
    record.sources = record.sources?.filter((candidate) => candidate.id !== source.id);
    const proof = record.provenance;
    if (proof?.id === source.id) {
      if (await this.provenanceScope(record, source.id, proof.scope.claim_generation))
        await browser.tabs.remove(proof.tabId).catch(() => {});
      delete record.provenance;
    }
    await this.save(record);
  }
  async liveRecords() {
    const live = [];
    for (const record of this.records.values()) {
      const provenance = record.provenance;
      if (
        provenance &&
        !provenance.released &&
        (await this.provenanceScope(
          record,
          provenance.id,
          provenance.scope.claim_generation,
          provenance,
        ))
      )
        live.push({
          id: 'discovery-resource:' + record.id,
          generation: record.generation,
          tab_id: provenance.tabId,
          scope: provenance.scope,
        });
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
        (value as RecordState).sessionEpoch === (await this.epoch()) &&
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
          const provenance = record.provenance;
          if (
            provenance &&
            (await this.provenanceScope(
              record,
              provenance.id,
              provenance.scope.claim_generation,
              provenance,
            ))
          )
            await browser.tabs.remove(provenance.tabId).catch(() => {});
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
        if (state.selected?.length) {
          const selected = await this.native('discovery_select', {
            id: record.id,
            scope: record.scope,
            generation: record.generation,
            urls: state.selected,
          });
          record.jobs = [...new Set([...(record.jobs ?? []), ...selected.jobs])].slice(-1000);
          record.sources = [
            ...(record.sources ?? []).filter((source) => !selected.jobs.includes(source.id)),
            ...selected.sources,
          ];
          await this.save(record);
        }
        for (const source of [...(record.sources ?? [])]) await this.startResource(record, source);
        if (state.status !== 'exploring') continue;
        const tab =
          record.tabId >= 0 ? await browser.tabs.get(record.tabId).catch(() => null) : null;
        if (!tab) {
          if (record.tabId >= 0) {
            // A lost owned tab leaves the native scheduler lease bound to its old ID.
            // Verify the original session before releasing it; never recover in a default session.
            const source = await scopeForTab(
              browser,
              BROWSER,
              record.scope.profile,
              record.sourceTabId,
              record.scope.claim_generation,
            );
            if (!sameScope(source, record.scope)) throw Error('Discovery source session changed');
            // wait_browser releases the stale lease without resetting the discovery time budget.
            await this.native('discovery_status', {
              id: record.id,
              scope: record.scope,
              generation: record.generation,
              action: 'wait_browser',
            });
          }
          await this.advance(record);
        } else {
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
        await this.native('discovery_status', {
          id: record.id,
          scope: record.scope,
          generation: record.generation,
          action: 'wait_browser',
        }).catch(() => {});
        /* Retain durable frontier; browser absence/session expiry never falls back anonymously. */
      } finally {
        this.busy.delete(record.id);
      }
    }
  }
}
