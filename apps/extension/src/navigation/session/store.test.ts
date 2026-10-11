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
    await regular.remove('resolver-legacy-private');
    expect((await local.get())['resolver-legacy-private']).toEqual(privateValue);
    expect(durableNavigationRecord('resolver-private', privateValue)).toBeUndefined();
  });
});
