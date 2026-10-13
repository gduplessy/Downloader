import { describe, expect, it, vi } from 'vitest';
import { NavigationTransferSession, canPrepareTransfer } from './NavigationTransfer';
import { transferLabels, transferLocales } from './NavigationTransfer.labels';
import type { Job } from '../types';
const scope = {
  browser: 'chromium',
  profile: 'owner',
  private: false,
  cookie_store_id: '0',
  container_id: null,
  partition_key: { top_level_site: 'https://fixture.example' },
  claim_generation: 9,
};
const job = () =>
  ({
    id: 'job',
    request_id: 'fixture',
    url: 'https://fixture.example/file',
    filename: 'file.bin',
    destination: 'fixture.bin',
    queue: 'default',
    category: '',
    total: null,
    speed: 0,
    resumable: false,
    etag: null,
    error: null,
    created: 'fixture',
    description: '',
    checksum: null,
    media: null,
    viable: false,
    navigation_scope: structuredClone(scope),
    source_generation: 12,
    state: 'waiting_browser',
    bytes: 0,
    segments: [],
    navigation_transfer_pending: false,
    navigation_transfer_recovery: false,
  }) as Job;
const reply = () => ({
  id: 'job',
  scope: { ...structuredClone(scope), claim_generation: 10 },
  source_generation: 13,
  token: 'fixture-only-transfer-code',
  expires_at_ms: 105000,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function setup(request = vi.fn().mockResolvedValue(reply())) {
  let now = 100000;
  const refresh = vi.fn().mockResolvedValue(undefined);
  const session = new NavigationTransferSession(job(), request, refresh, () => now);
  return { session, request, refresh, setNow: (value: number) => (now = value) };
}
describe('desktop transfer lifetime and exact native fences', () => {
  it('does nothing until an explicit prepare and accepts exactly the advanced frozen claim/source', async () => {
    const { session, request } = setup();
    expect(request).not.toHaveBeenCalled();
    expect(session.code).toBeNull();
    await session.prepare();
    expect(request).toHaveBeenCalledWith({
      action: 'prepare',
      id: 'job',
      expected_scope: scope,
      expected_source_generation: 12,
      consent: true,
    });
    expect(session.code).toBe(reply().token);
    session.update({
      ...job(),
      state: 'waiting_user',
      navigation_scope: reply().scope,
      source_generation: 13,
      navigation_transfer_pending: true,
    });
    expect(session.code).toBe(reply().token);
    expect(session.canPrepare).toBe(false);
  });
  it('rejects a delayed reply after input ownership changes without cancelling automatically', async () => {
    const pending = deferred<ReturnType<typeof reply>>();
    const request = vi.fn().mockReturnValue(pending.promise);
    const { session } = setup(request);
    const preparing = session.prepare();
    session.update({ ...job(), source_generation: 99 });
    pending.resolve(reply());
    await preparing;
    expect(session.code).toBeNull();
    expect(session.getSnapshot().phase).toBe('stale');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects an in-place mutated input instead of remaining indefinitely busy', async () => {
    const input = job();
    const pending = deferred<ReturnType<typeof reply>>();
    const session = new NavigationTransferSession(
      input,
      () => pending.promise,
      async () => {},
      () => 100000,
    );
    const preparing = session.prepare();
    input.source_generation = 99;
    pending.resolve(reply());
    await preparing;
    expect(session.code).toBeNull();
    expect(session.getSnapshot().phase).toBe('stale');
  });
  it.each([
    'source',
    'claim',
    'profile',
    'private',
    'cookie',
    'container',
    'partition',
    'ancestor',
    'id',
    'expiry',
  ] as const)('rejects a reply with changed %s without exposing its code', async (field) => {
    const value = reply();
    if (field === 'source') value.source_generation = 12;
    if (field === 'claim') value.scope.claim_generation = 9;
    if (field === 'profile') value.scope.profile = 'foreign';
    if (field === 'private') value.scope.private = true;
    if (field === 'cookie') value.scope.cookie_store_id = 'foreign-store';
    if (field === 'container')
      (value.scope as { container_id: string | null }).container_id = 'foreign-container';
    if (field === 'partition') value.scope.partition_key.top_level_site = 'https://foreign.example';
    if (field === 'ancestor')
      (
        value.scope.partition_key as { top_level_site: string; has_cross_site_ancestor?: boolean }
      ).has_cross_site_ancestor = false;
    if (field === 'id') value.id = 'foreign-job';
    if (field === 'expiry') value.expires_at_ms = 99999;
    const { session } = setup(vi.fn().mockResolvedValue(value));
    await session.prepare();
    expect(session.code).toBeNull();
    expect(session.getSnapshot().error).toBe('preparationFailed');
  });
  it('forgets an expired code, refreshes metadata, and never sends automatic cancel', async () => {
    const { session, request, refresh, setNow } = setup();
    await session.prepare();
    setNow(104001);
    session.tick();
    expect(session.getSnapshot().seconds).toBe(1);
    setNow(105000);
    session.tick();
    expect(session.code).toBeNull();
    expect(session.getSnapshot().phase).toBe('expired');
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    session.tick();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('clears the code immediately and cancels only using the prepared frozen fences', async () => {
    const cancelled = deferred<unknown>();
    const request = vi.fn().mockResolvedValueOnce(reply()).mockReturnValueOnce(cancelled.promise);
    const { session } = setup(request);
    await session.prepare();
    session.update({
      ...job(),
      navigation_scope: reply().scope,
      source_generation: 13,
      navigation_transfer_pending: true,
    });
    const cancel = session.cancel();
    expect(session.code).toBeNull();
    expect(request).toHaveBeenLastCalledWith({
      action: 'cancel',
      id: 'job',
      expected_scope: reply().scope,
      expected_source_generation: 13,
    });
    expect(request.mock.calls[1][0]).not.toHaveProperty('token');
    cancelled.resolve({});
    await cancel;
    expect(session.getSnapshot().phase).toBe('cancelled');
    expect(session.canPrepare).toBe(false);
  });
  it('keeps native pending state manual after a cancel refusal and sanitizes the error', async () => {
    const request = vi
      .fn()
      .mockRejectedValue(Error('transfer_scope_stale fixture-secret-not-for-display'));
    const { session } = setup(request);
    session.update({ ...job(), navigation_transfer_pending: true });
    await session.cancel();
    expect(session.getSnapshot().error).toBe('stale');
    expect(session.canPrepare).toBe(false);
    expect(session.canCancel).toBe(true);
  });
  it('uses latest native fences when a pending code is not held by this panel', async () => {
    const { session, request } = setup();
    session.update({
      ...job(),
      navigation_scope: reply().scope,
      source_generation: 13,
      navigation_transfer_pending: true,
    });
    expect(session.canPrepare).toBe(false);
    await session.cancel();
    expect(request).toHaveBeenCalledWith({
      action: 'cancel',
      id: 'job',
      expected_scope: reply().scope,
      expected_source_generation: 13,
    });
  });
  it('forgets codes on unmount and ignores pending replies without sending cancel', async () => {
    const pending = deferred<ReturnType<typeof reply>>();
    const request = vi.fn().mockReturnValue(pending.promise);
    const { session } = setup(request);
    const preparing = session.prepare();
    session.dispose();
    pending.resolve(reply());
    await preparing;
    expect(session.code).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    session.mount();
    expect(session.code).toBeNull();
    const ready = setup();
    await ready.session.prepare();
    ready.session.dispose();
    expect(ready.session.code).toBeNull();
    expect(ready.request).toHaveBeenCalledTimes(1);
  });
  it('does not duplicate a double-clicked prepare or silently move partial/active jobs', async () => {
    const pending = deferred<ReturnType<typeof reply>>();
    const request = vi.fn().mockReturnValue(pending.promise);
    const { session } = setup(request);
    const preparing = session.prepare();
    await session.prepare();
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve(reply());
    await preparing;
    for (const changes of [
      { state: 'downloading' },
      { bytes: 1 },
      { segments: [{ start: 0, end: 1, downloaded: 1 }] },
      { partial_created: true },
      { navigation_scope: null },
      { navigation_transfer_pending: true },
      { source_generation: Number.MAX_SAFE_INTEGER },
    ])
      expect(canPrepareTransfer({ ...job(), ...changes })).toBe(false);
    expect(
      canPrepareTransfer({
        ...job(),
        navigation_scope: { ...scope, private: true, cookie_store_id: '1' },
      }),
    ).toBe(true);
  });
});
describe('transfer instructions in all supported locales', () => {
  it.each(transferLocales)('provides complete %s labels and expiry instructions', (locale) => {
    const labels = transferLabels(locale);
    expect(
      Object.values(labels).every((value) => typeof value === 'string' && value.length > 0),
    ).toBe(true);
    expect(labels.expires).toContain('{seconds}');
    expect(labels.recipient).toContain('HTTP/HTTPS');
    expect(labels.code).toBeTruthy();
    expect(labels.cancel).toBeTruthy();
    expect(labels.privacy).toBeTruthy();
  });
  it('uses the language fallback without showing untranslated identifiers', () => {
    expect(transferLabels('fr-CA')).toEqual(transferLabels('fr'));
    expect(transferLabels('unknown')).toEqual(transferLabels('en'));
  });
});
