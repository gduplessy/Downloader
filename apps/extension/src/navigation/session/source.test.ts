import { describe, it, expect } from 'vitest';
import { NavigationSources } from './source';
function storage() {
  const values: Record<string, any> = {};
  return {
    values,
    async get(key: string) {
      return { [key]: values[key] };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(values, items);
    },
    async remove(key: string) {
      delete values[key];
    },
  };
}
function fixture() {
  let tab: any = {
    id: 8,
    windowId: 2,
    url: 'https://source.example/start',
    cookieStoreId: 'firefox-container-8',
    incognito: false,
  };
  let present = true;
  const api = {
    tabs: {
      async get(id: number) {
        if (!present || id !== tab.id) throw Error('Unknown tab');
        return { ...tab };
      },
    },
    cookies: {
      async getAllCookieStores() {
        return [{ id: tab.cookieStoreId, tabIds: [tab.id] }];
      },
    },
  };
  const transient = storage(),
    markers = storage();
  const source = new NavigationSources(
    api,
    'firefox',
    Promise.resolve('profile'),
    Promise.resolve('epoch'),
    transient,
    markers,
    false,
  );
  const job = { id: 'job', request_id: 'request', source_generation: 7, private: false };
  return {
    api,
    transient,
    markers,
    source,
    job,
    change: (values: any) => (tab = { ...tab, ...values }),
    close: () => (present = false),
  };
}
describe('pending navigation origins', () => {
  it('captures before native reply and resolves actual source when a queued task finally admits', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    expect(await f.source.resolve(f.job)).toBe(8);
    expect(f.transient.values['navigation-source-origin-request'].sourceGeneration).toBe(7);
  });
  it('survives worker suspension without promoting the user tab into an owned resolver', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    const restored = new NavigationSources(
      f.api,
      'firefox',
      Promise.resolve('profile'),
      Promise.resolve('epoch'),
      f.transient,
      f.markers,
      false,
    );
    expect(await restored.resolve(f.job)).toBe(8);
    expect(f.transient.values['navigation-source-origin-request']).not.toHaveProperty('scope');
  });
  it('stops when actual source disappears rather than returning undefined/default context', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    f.close();
    await expect(f.source.resolve(f.job)).rejects.toMatchObject({
      code: 'navigation_source_unavailable',
    });
    await f.source.invalidate(f.job);
    await expect(f.source.resolve(f.job)).rejects.toMatchObject({
      code: 'navigation_source_explicit_recovery_required',
    });
  });
  it('keeps only a nonsecret durable requirement after browser restart', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    const restarted = new NavigationSources(
      f.api,
      'firefox',
      Promise.resolve('profile'),
      Promise.resolve('new epoch'),
      storage(),
      f.markers,
      false,
    );
    await expect(restarted.resolve(f.job)).rejects.toMatchObject({
      code: 'navigation_source_explicit_recovery_required',
    });
    expect(f.markers.values['navigation-source-required-request']).toEqual({ required: true });
  });
  it('rejects browser epoch changes even when tabs are reused', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    const restarted = new NavigationSources(
      f.api,
      'firefox',
      Promise.resolve('profile'),
      Promise.resolve('new epoch'),
      f.transient,
      f.markers,
      false,
    );
    await expect(restarted.resolve(f.job)).rejects.toMatchObject({
      code: 'navigation_source_browser_epoch_changed',
    });
  });
  it.each([
    { cookieStoreId: 'firefox-default' },
    { incognito: true },
    { windowId: 3 },
    { url: 'https://other.example/' },
  ])('rejects a changed actual source context %j', async (changed) => {
    const f = fixture();
    await f.source.prepare('request', 8);
    f.change(changed);
    await expect(f.source.resolve(f.job)).rejects.toMatchObject({
      code: 'navigation_source_session_changed',
    });
  });
  it('binds exact native generation and rejects source replacement', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    await f.source.resolve(f.job);
    await expect(f.source.resolve({ ...f.job, source_generation: 8 })).rejects.toMatchObject({
      code: 'navigation_source_generation_changed',
    });
  });
  it('rejects native ownership replacement before admission', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    await expect(
      f.source.resolve({ ...f.job, navigation_owner: 'foreign-profile' }),
    ).rejects.toMatchObject({ code: 'navigation_source_owner_changed' });
  });
  it('rejects missing native counters instead of assigning a default', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    await expect(
      f.source.resolve({ ...f.job, source_generation: undefined as any }),
    ).rejects.toMatchObject({ code: 'navigation_source_generation_invalid' });
  });
  it('refuses a foreign native store without inheriting target partition metadata', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    await expect(
      f.source.resolve({
        ...f.job,
        navigation_scope: {
          browser: 'firefox',
          profile: 'profile',
          private: false,
          cookie_store_id: 'firefox-default',
          container_id: null,
          partition_key: null,
        },
      }),
    ).rejects.toMatchObject({ code: 'navigation_source_explicit_transfer_required' });
  });
  it('does not resurrect an origin when cancellation races an in-flight resolve', async () => {
    const f = fixture();
    await f.source.prepare('request', 8);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = f.api.tabs.get;
    f.api.tabs.get = async (id) => {
      await gate;
      return original(id);
    };
    const resolving = f.source.resolve(f.job);
    const invalidating = f.source.invalidate(f.job);
    release();
    await resolving;
    await invalidating;
    await expect(f.source.resolve(f.job)).rejects.toMatchObject({
      code: 'navigation_source_explicit_recovery_required',
    });
  });
  it('leaves CLI-created unhinted tasks alone and clears only hints once a real resolver is adopted', async () => {
    const f = fixture();
    expect(await f.source.resolve(f.job)).toBeUndefined();
    await f.source.prepare('request', 8);
    await f.source.adopted(f.job);
    expect(await f.source.resolve(f.job)).toBeUndefined();
    expect(f.transient.values).toEqual({});
    expect(f.markers.values).toEqual({});
  });
});
