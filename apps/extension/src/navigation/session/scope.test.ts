import { describe, it, expect } from 'vitest';
import { scopeForTab, RequestCorrelation, sameScope } from './scope';
const scope = {
  browser: 'chromium',
  profile: crypto.randomUUID(),
  private: false,
  cookie_store_id: '0',
  container_id: null,
  partition_key: { top_level_site: 'https://example.test' },
  claim_generation: 1,
};
describe('explicit browser sessions', () => {
  it('refuses missing cookie stores and partition APIs without default substitution', async () => {
    const api: any = {
      tabs: { get: async () => ({ incognito: false }) },
      cookies: { getAllCookieStores: async () => [] },
    };
    await expect(scopeForTab(api, 'chromium', scope.profile, 5, 1)).rejects.toThrow('substitution');
    api.cookies.getAllCookieStores = async () => [{ id: '0', tabIds: [5] }];
    await expect(scopeForTab(api, 'chromium', scope.profile, 5, 1)).rejects.toThrow('Partition');
  });
  it('preserves private, container and partition context', async () => {
    const api: any = {
      tabs: { get: async () => ({ incognito: true, cookieStoreId: 'firefox-container-2' }) },
      cookies: { getAllCookieStores: async () => [{ id: 'firefox-container-2', tabIds: [5] }] },
    };
    const actual = await scopeForTab(api, 'firefox', scope.profile, 5, 9);
    expect(actual.private).toBe(true);
    expect(actual.container_id).toBe('firefox-container-2');
    expect(actual.claim_generation).toBe(9);
    api.tabs.get = async () => ({ incognito: false });
    api.cookies.getAllCookieStores = async () => [{ id: '0', tabIds: [5] }];
    api.cookies.getPartitionKey = async () => ({
      partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false },
    });
    expect((await scopeForTab(api, 'chromium', scope.profile, 5, 1)).partition_key).toEqual({
      top_level_site: 'https://example.test',
      has_cross_site_ancestor: false,
    });
  });
  it('does not correlate identical URLs across competing tabs or generations', () => {
    const records = new RequestCorrelation();
    const request = {
      requestId: '1',
      tabId: 5,
      frameId: 0,
      url: 'https://example.test/file',
      method: 'POST',
      headers: {},
      time: Date.now(),
      scope,
    };
    records.observe(request);
    records.observe({ ...request, requestId: '2', tabId: 6 });
    expect(records.find(request.url, scope)).toBeUndefined();
    expect(records.find(request.url, scope, 5, 0)?.requestId).toBe('1');
    expect(records.find(request.url, { ...scope, claim_generation: 2 }, 5, 0)).toBeUndefined();
    records.removeTab(5);
    expect(records.find(request.url, scope)?.tabId).toBe(6);
  });
  it('preserves scope identity across native JSON property ordering', () => {
    const chromium = {
      ...scope,
      partition_key: { top_level_site: 'https://example.test', has_cross_site_ancestor: false },
    };
    const native = {
      ...scope,
      partition_key: { has_cross_site_ancestor: false, top_level_site: 'https://example.test' },
    };
    expect(sameScope(chromium, native)).toBe(true);
    expect(
      sameScope(chromium, {
        ...native,
        partition_key: { ...native.partition_key, has_cross_site_ancestor: true },
      }),
    ).toBe(false);
  });
  it('fences profile, private, cookie store, partition and claim changes', () => {
    for (const change of [
      { profile: crypto.randomUUID() },
      { private: true },
      { cookie_store_id: '1' },
      { partition_key: { top_level_site: 'https://other.test' } },
      { claim_generation: 2 },
    ])
      expect(sameScope(scope, { ...scope, ...change })).toBe(false);
  });
});
