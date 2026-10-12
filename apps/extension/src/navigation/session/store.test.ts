import { describe, it, expect } from 'vitest';
import { durableNavigationRecord, navigationStorage, memoryStorage } from './store';
const scope = {
  browser: 'chromium',
  profile: crypto.randomUUID(),
  private: false,
  cookie_store_id: '0',
  container_id: null,
  partition_key: null,
  claim_generation: 1,
};
describe('browser restart references and private overlay', () => {
  it.each([false, true])('rejects delayed stale writes and recovers the write queue (private=%s)', async (privateWorker: boolean) => {
    const local = memoryStorage(), session = memoryStorage();
    const store = navigationStorage(local, session, privateWorker);
    const first = {scope: {...scope, private: privateWorker}, sourceGeneration: 1, tabId: 7};
    await store.set({'resolver-job': first});
    const stale = (await store.get('resolver-job'))['resolver-job'];
    const current = {...first, sourceGeneration: 2, scope: {...first.scope, claim_generation: 2}};
    const renewed = store.set({'resolver-job': current});
    const delayed = store.set({'resolver-job': {...stale, steps: 1}});
    await renewed;
    await expect(delayed).rejects.toThrow('Navigation record is stale');
    expect((await store.get('resolver-job'))['resolver-job']).toEqual(current);
    await expect(store.set({'resolver-job': {...current, sourceGeneration: 1}})).rejects.toThrow('stale');
    await expect(store.set({'resolver-job': {...current, scope: undefined}})).rejects.toThrow('stale');
    await store.set({'resolver-job': {...current, steps: 2}});
    expect((await store.get('resolver-job'))['resolver-job'].steps).toBe(2);
    if (privateWorker) expect(await local.get()).toEqual({});
  });
  it('memory storage snapshots cannot mutate stored authority by alias', async () => {
    const store = memoryStorage();
    const record = {scope: {...scope}, sourceGeneration: 1};
    await store.set({'resolver-job': record});
    record.scope.claim_generation = 9;
    const read = (await store.get())['resolver-job'];
    expect(read.scope.claim_generation).toBe(1);
    read.scope.claim_generation = 10;
    expect((await store.get('resolver-job'))['resolver-job'].scope.claim_generation).toBe(1);
  });
  it('persists regular job refs but never signed request URLs, cookies or preview text', async () => {
    const local = memoryStorage(),
      session = memoryStorage();
    const store = navigationStorage(local, session, false);
    const value = {
      tabId: 5,
      scope,
      sourceGeneration: 1,
      sessionEpoch: 'browser-1',
      request: { url: 'https://file.test/?secret=marker' },
      context: { headers: { Cookie: 'secret-marker' } },
      fingerprint: 'preview-secret-marker',
    };
    await store.set({ 'resolver-job': value, 'pending-handoff': value });
    expect((await store.get('resolver-job'))['resolver-job'].request).toEqual(value.request);
    const durable = JSON.stringify(await local.get());
    expect(durable).not.toContain('secret');
    expect(durable).not.toContain('pending');
    const afterRestart = navigationStorage(local, memoryStorage(), false);
    expect((await afterRestart.get('resolver-job'))['resolver-job']).toEqual({
      scope,
      tabId: 5,
      sourceGeneration: 1,
      sessionEpoch: 'browser-1',
    });
  });
  it('does not persist or silently erase legacy private records', async () => {
    const local = memoryStorage(),
      session = memoryStorage();
    const privateValue = {
      scope: { ...scope, private: true },
      tabId: 6,
      request: { url: 'private-secret' },
    };
    await local.set({ 'resolver-legacy-private': privateValue });
    const store = navigationStorage(local, session, true);
    await store.set({ 'resolver-private': privateValue });
    expect((await local.get())['resolver-private']).toBeUndefined();
    const regular = navigationStorage(local, session, false);
    expect((await regular.get())['resolver-legacy-private']).toBeUndefined();
    expect((await regular.get())['resolver-private']).toBeUndefined();
    await regular.remove('resolver-legacy-private');
    expect((await local.get())['resolver-legacy-private']).toEqual(privateValue);
    expect(durableNavigationRecord('resolver-private', privateValue)).toBeUndefined();
  });
  it('recovers normalized waits without persisting page reasons or signed origins', () => {
    const record = durableNavigationRecord('resolver-job', {
      scope,
      generation: 3,
      waitStarted: 1000,
      waitedMs: 50,
      lastOrigin: 'https://file.test/?token=secret',
      wait: {
        generation: 2,
        source_generation: 3,
        observed_at_ms: 1000,
        observed_duration_ms: 500,
        deadline_ms: 1500,
        next_recheck_ms: 1500,
        basis: 'page',
        requires_live_tab: true,
        expires_at_ms: null,
        reason: 'https://file.test/?token=secret',
        notified: false,
      },
    });
    expect(record.generation).toBe(3);
    expect(record.wait.source_generation).toBe(3);
    expect(JSON.stringify(record)).not.toContain('secret');
    expect(
      durableNavigationRecord('resolver-job', { scope, lastOrigin: 'https://file.test' })
        .lastOrigin,
    ).toBe('https://file.test');
  });
});
