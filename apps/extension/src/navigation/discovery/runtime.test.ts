import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  scope: vi.fn(),
  document: vi.fn(),
  browser: {
    storage: { local: { get: vi.fn(), set: vi.fn() } },
    tabs: { get: vi.fn(), create: vi.fn(), remove: vi.fn() },
    permissions: { contains: vi.fn() },
  },
}));
vi.mock('webextension-polyfill', () => ({ default: mocks.browser }));
vi.mock('../session/scope', () => ({
  scopeForTab: mocks.scope,
  sameScope: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
}));
vi.mock('../session/document', () => ({ verifyLiveDocument: mocks.document }));
import { RenderedDiscovery } from './runtime';
const scope = {
  browser: 'chromium',
  profile: 'owner',
  private: false,
  cookie_store_id: '0',
  container_id: null,
  partition_key: null,
  claim_generation: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('BROWSER', 'chromium');
});
function setup() {
  const native = vi.fn().mockResolvedValue({ scope });
  const discovery = new RenderedDiscovery(
    native,
    async () => 'owner',
    false,
    async () => 'epoch',
    async () => true,
  );
  const provenance = { id: 'job', tabId: 2, scope, document: { nonce: 'document', generation: 1 } };
  const record = {
    id: 'project',
    scope,
    generation: 1,
    tabId: -1,
    sourceTabId: 1,
    jobs: ['job'],
    provenance,
    sessionEpoch: 'epoch',
  };
  (discovery as any).records.set('project', record);
  mocks.scope.mockImplementation(async (_api, _browser, _profile, tabId) =>
    tabId === 1 ? null : scope,
  );
  return { discovery, record, native, provenance };
}
describe('retained provenance ownership', () => {
  it('rejects a proof removed while its actual document check is pending', async () => {
    const { discovery, record, native } = setup();
    let checked!: () => void;
    mocks.document.mockImplementation(
      () =>
        new Promise((resolve) => {
          checked = () => resolve(true);
        }),
    );
    const pending = discovery.scopeForJob('job');
    for (let i = 0; i < 10 && !checked; i++) await Promise.resolve();
    delete (record as any).provenance;
    checked();
    expect(await pending).toBeNull();
    expect(native).not.toHaveBeenCalled();
  });
  it('requires the current retained document before renewing exact native authority', async () => {
    const { discovery, native } = setup();
    mocks.document.mockResolvedValue(true);
    expect(await discovery.scopeForJob('job')).toEqual(scope);
    expect(native).toHaveBeenCalledWith('navigation_authority', {
      id: 'job',
      owner: 'owner',
      scope,
    });
    mocks.document.mockResolvedValue(false);
    expect(await discovery.sourceForJob({ id: 'job', navigation_scope: scope })).toBeUndefined();
  });
});

describe('lost discovery tab recovery', () => {
  function recovery() {
    const record = {
      id: 'project',
      scope,
      generation: 1,
      tabId: 2,
      sourceTabId: 1,
      jobs: [],
      sessionEpoch: 'epoch',
      page_url: 'https://host.test/project',
      windowId: 4,
      permitted_origins: [],
    };
    let lease: number | null = 2;
    const native = vi.fn(async (command: string, args: any) => {
      if (command === 'discovery_status') {
        if (args.action === 'wait_browser') lease = null;
        return { status: 'exploring' };
      }
      if (command === 'discovery_claim') {
        if (args.tab_id !== null) {
          if (lease !== null && lease !== args.tab_id) throw Error('Navigation tab mismatch');
          lease = args.tab_id;
        }
        return { page: { url: record.page_url } };
      }
      throw Error('Unexpected command');
    });
    mocks.browser.storage.local.get.mockResolvedValue({});
    mocks.browser.storage.local.set.mockResolvedValue(undefined);
    mocks.browser.tabs.get.mockRejectedValue(Error('Tab closed'));
    mocks.browser.tabs.create.mockResolvedValue({ id: 3, incognito: false, status: 'loading' });
    mocks.browser.permissions.contains.mockResolvedValue(true);
    mocks.scope.mockResolvedValue(scope);
    const discovery = new RenderedDiscovery(
      native,
      async () => 'owner',
      false,
      async () => 'epoch',
      async () => true,
    );
    (discovery as any).records.set(record.id, record);
    return { discovery, native, record, lease: () => lease };
  }
  it('releases the old native tab lease before admitting its exact-session replacement', async () => {
    const { discovery, native, record, lease } = recovery();
    await discovery.poll();
    expect(mocks.scope).toHaveBeenCalledWith(mocks.browser, 'chromium', 'owner', 1, 1);
    expect(
      native.mock.calls.map(([command, args]) => [command, args.action ?? args.tab_id]),
    ).toEqual([
      ['discovery_status', 'snapshot'],
      ['discovery_status', 'wait_browser'],
      ['discovery_claim', null],
      ['discovery_claim', 3],
    ]);
    expect(mocks.browser.tabs.create).toHaveBeenCalledWith({
      url: record.page_url,
      active: false,
      windowId: 4,
    });
    expect(record.tabId).toBe(3);
    expect(lease()).toBe(3);
    expect(native.mock.calls.some(([, args]) => args.action === 'resume')).toBe(false);
  });
  it('does not open a replacement after native cancellation invalidates recovery', async () => {
    const { discovery, native } = recovery();
    const implementation = native.getMockImplementation()!;
    native.mockImplementation(async (command: string, args: any) => {
      if (command === 'discovery_status' && args.action === 'wait_browser')
        throw Error('Generation changed');
      return implementation(command, args);
    });
    await discovery.poll();
    expect(mocks.browser.tabs.create).not.toHaveBeenCalled();
    expect(native.mock.calls.filter(([command]) => command === 'discovery_claim')).toEqual([]);
  });
  it.each(['missing', 'changed'])(
    'retains the frontier without replacement when original source is %s',
    async (state) => {
      const { discovery, native } = recovery();
      if (state === 'missing') mocks.scope.mockRejectedValue(Error('Source closed'));
      else mocks.scope.mockResolvedValue({ ...scope, cookie_store_id: 'other-container' });
      await discovery.poll();
      expect(mocks.browser.tabs.create).not.toHaveBeenCalled();
      expect(native.mock.calls.filter(([command]) => command === 'discovery_claim')).toEqual([]);
      expect(native).toHaveBeenLastCalledWith('discovery_status', {
        id: 'project',
        scope,
        generation: 1,
        action: 'wait_browser',
      });
    },
  );
});
