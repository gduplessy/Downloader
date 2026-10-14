import type { SessionScope } from '../../../../../packages/shared/src/navigation';
export function sessionKey(scope: SessionScope): string {
  return JSON.stringify({
    browser: scope.browser,
    profile: scope.profile,
    private: scope.private,
    cookie_store_id: scope.cookie_store_id,
    container_id: scope.container_id,
    partition_key: scope.partition_key
      ? {
          top_level_site: scope.partition_key.top_level_site,
          has_cross_site_ancestor: scope.partition_key.has_cross_site_ancestor,
        }
      : null,
  });
}
export function sameScope(a: SessionScope, b: SessionScope): boolean {
  return sessionKey(a) === sessionKey(b) && a.claim_generation === b.claim_generation;
}
export interface ScopedRequest {
  requestId: string;
  tabId: number;
  frameId: number;
  documentId?: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  time: number;
  scope: SessionScope;
}
export class RequestCorrelation {
  private records = new Map<string, ScopedRequest>();
  observe(request: ScopedRequest): void {
    if (request.tabId < 0 || request.frameId < 0 || !request.scope.cookie_store_id)
      throw Error('Request has no explicit browser session');
    this.records.set(this.key(request), request);
    for (const [key, record] of this.records)
      if (Date.now() - record.time > 120000) this.records.delete(key);
    // Bound memory independently of browsing duration.
    if (this.records.size > 1024) this.records.delete(this.records.keys().next().value!);
  }
  private key(r: ScopedRequest) {
    return JSON.stringify([
      r.requestId,
      r.tabId,
      r.frameId,
      r.documentId,
      sessionKey(r.scope),
      r.scope.claim_generation,
    ]);
  }
  find(
    url: string,
    scope: SessionScope,
    tabId?: number,
    frameId?: number,
  ): ScopedRequest | undefined {
    const matches = [...this.records.values()].filter(
      (r) =>
        r.url === url &&
        sameScope(r.scope, scope) &&
        (tabId === undefined || r.tabId === tabId) &&
        (frameId === undefined || r.frameId === frameId),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  unique(url: string, privateSession: boolean): ScopedRequest | undefined {
    const matches = [...this.records.values()].filter(
      (r) => r.url === url && r.scope.private === privateSession,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  removeTab(tabId: number) {
    for (const [key, record] of this.records) if (record.tabId === tabId) this.records.delete(key);
  }
}
export interface ScopeBrowser {
  tabs: { get(id: number): Promise<any> };
  cookies: {
    getAllCookieStores(): Promise<any[]>;
    getPartitionKey?: (details: any) => Promise<any>;
  };
}
export type ScopeContext = Omit<SessionScope, 'claim_generation'>;
export async function contextForTab(
  api: ScopeBrowser,
  browser: string,
  profile: string,
  tabId: number,
  frameId = 0,
): Promise<ScopeContext> {
  const tab = await api.tabs.get(tabId);
  const stores = await api.cookies.getAllCookieStores();
  const store = stores.find((s) => s.tabIds.includes(tabId));
  if (!store || (tab.cookieStoreId && tab.cookieStoreId !== store.id))
    throw Error('Explicit cookie store unavailable; session substitution denied');
  let partition_key: SessionScope['partition_key'] = null;
  if (browser === 'chromium') {
    if (!api.cookies.getPartitionKey)
      throw Error('Partition scope API unavailable; direct capture denied');
    const partition = await api.cookies.getPartitionKey({ tabId, frameId });
    if (partition?.partitionKey)
      partition_key = {
        top_level_site: partition.partitionKey.topLevelSite,
        ...(partition.partitionKey.hasCrossSiteAncestor !== undefined
          ? { has_cross_site_ancestor: partition.partitionKey.hasCrossSiteAncestor }
          : {}),
      };
  }
  return {
    browser,
    profile,
    private: tab.incognito === true,
    cookie_store_id: store.id,
    container_id:
      browser === 'firefox' && store.id.startsWith('firefox-container-') ? store.id : null,
    partition_key,
  };
}

export async function scopeForTab(
  api: ScopeBrowser,
  browser: string,
  profile: string,
  tabId: number,
  generation: number,
  frameId = 0,
): Promise<SessionScope> {
  return {
    ...(await contextForTab(api, browser, profile, tabId, frameId)),
    claim_generation: generation,
  };
}
