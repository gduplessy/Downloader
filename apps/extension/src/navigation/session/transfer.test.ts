import { describe, it, expect, vi, afterEach } from 'vitest';
import { NavigationTransfer } from './transfer';
import type { SessionScope } from '../../../../../packages/shared/src/navigation';
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const profile = crypto.randomUUID();
  let store = '0';
  const tabs = new Map([
    [
      5,
      { id: 5, windowId: 1, url: 'https://recipient.test/', status: 'complete', incognito: false },
    ],
  ]);
  const api = {
    tabs: {
      get: vi.fn(async (id: number) => tabs.get(id)),
      create: vi.fn(async (args: any) => {
        const tab = { ...args, id: 6, status: 'complete', incognito: false };
        tabs.set(6, tab);
        return tab;
      }),
    },
    cookies: {
      getAllCookieStores: async () => [{ id: store, tabIds: [...tabs.keys()] }],
      getPartitionKey: async ({ tabId }: { tabId: number }) => ({
        partitionKey: { topLevelSite: new URL(tabs.get(tabId)!.url).origin },
      }),
    },
  };
  const preview = {
    id: 'job',
    filename: 'fixture.bin',
    page_url: 'https://original.test/file',
    private: false,
    expires_at_ms: Date.now() + 300000,
    source_generation: 2,
    claim_generation: 2,
  };
  const native = vi.fn(async (args: any) =>
    args.action === 'preview'
      ? preview
      : {
          id: 'job',
          scope: { ...args.recipient_scope, claim_generation: 3 },
          source_generation: 2,
        },
  );
  const adopted = vi.fn(
    async (_accepted: { scope: SessionScope }, _tabId: number, _page: string) => {},
  );
  const transfer = new NavigationTransfer(
    api,
    'chromium',
    Promise.resolve(profile),
    false,
    native,
    async () => true,
    adopted,
  );
  return {
    transfer,
    api,
    native,
    adopted,
    changeStore: () => {
      store = 'other';
    },
  };
}
describe('explicit recipient transfer', () => {
  it('requires an actual HTTP tab before disclosing a native preview', async () => {
    const f = fixture();
    f.api.tabs.get.mockResolvedValueOnce({
      id: 5,
      windowId: 1,
      url: 'about:blank',
      status: 'complete',
      incognito: false,
    });
    await expect(f.transfer.preview('x'.repeat(64), 5)).rejects.toThrow('HTTP tab');
    expect(f.native).not.toHaveBeenCalled();
  });
  it('refuses a session change between preview and accept before opening a page', async () => {
    const f = fixture();
    const p = await f.transfer.preview('x'.repeat(64), 5);
    f.changeStore();
    await expect(f.transfer.accept(p.preview_id, true)).rejects.toThrow('session changed');
    expect(f.api.tabs.create).not.toHaveBeenCalled();
    expect(f.native).toHaveBeenCalledTimes(1);
  });
  it('observes the actual new HTTP partition and cannot accept the same preview twice', async () => {
    const f = fixture();
    const p = await f.transfer.preview('x'.repeat(64), 5);
    await f.transfer.accept(p.preview_id, true);
    expect(f.native.mock.calls[1][0].recipient_scope.partition_key.top_level_site).toBe(
      'https://original.test',
    );
    expect(f.adopted.mock.calls[0][0].scope.partition_key?.top_level_site).toBe(
      'https://original.test',
    );
    await expect(f.transfer.accept(p.preview_id, true)).rejects.toThrow('explicitly accept');
    expect(f.api.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('expires and discards worker-only tickets without opening tabs', async () => {
    const f = fixture();
    const p = await f.transfer.preview('x'.repeat(64), 5);
    await vi.advanceTimersByTimeAsync(300001);
    await expect(f.transfer.accept(p.preview_id, true)).rejects.toThrow('explicitly accept');
    expect(f.api.tabs.create).not.toHaveBeenCalled();
  });
});
