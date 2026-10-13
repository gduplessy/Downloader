import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ scope: vi.fn(), document: vi.fn() }));
vi.mock('webextension-polyfill', () => ({ default: {} }));
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
