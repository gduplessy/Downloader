import { describe, it, expect, vi } from 'vitest';
import { admittedNavigationJob, type NavigationStartJob } from './preflight';
const job = (): NavigationStartJob => ({ id: 'job', request_id: 'request', source_generation: 7,
  state: 'waiting_browser', navigation_url: 'https://host.test/old-token', page_url: 'https://host.test/page',
  navigation_owner: 'profile', private: false, navigation_scope: { browser: 'firefox', profile: 'profile',
    private: false, cookie_store_id: 'firefox-container-2', container_id: 'firefox-container-2',
    partition_key: null, claim_generation: 3 } });
describe('native job preflight after scheduler admission', () => {
  it.each([
    ['source_generation', 8], ['navigation_url', 'https://host.test/new-token'],
    ['page_url', 'https://other.test/page'], ['state', 'cancelled'], ['navigation_owner', 'other'],
    ['private', true], ['navigation_transfer_pending', { nonce: 'transfer' }],
    ['navigation_transfer_recovery', true], ['removed', null],
    ['claim_generation', 4], ['container_id', 'firefox-container-3'],
    ['partition_key', { top_level_site: 'https://other.test' }],
  ])('performs zero HTTP tab creations when %s changes during admission', async (field, value) => {
    const expected = job(); let current: NavigationStartJob | undefined = structuredClone(expected);
    const create = vi.fn();
    const start = async () => {
      const admitted = async () => {
        if (field === 'removed') current = undefined;
        else if (['claim_generation', 'container_id', 'partition_key'].includes(field as string))
          (current!.navigation_scope as any)[field as string] = value;
        else (current as any)[field as string] = value;
        return true;
      };
      if (await admittedNavigationJob(expected, admitted, async () => ({ jobs: current ? [current] : [] })))
        create({ url: expected.navigation_url });
    };
    await expect(start()).rejects.toThrow('changed during admission');
    expect(create).not.toHaveBeenCalled();
  });
  it('reads fresh native data after admission and permits unchanged source', async () => {
    const events: string[] = []; const expected = job(); const create = vi.fn();
    if (await admittedNavigationJob(expected, async () => { events.push('admitted'); return true; },
      async () => { events.push('native snapshot'); return { jobs: [structuredClone(expected)] }; }))
      create({ url: expected.navigation_url });
    expect(events).toEqual(['admitted', 'native snapshot']);
    expect(create).toHaveBeenCalledWith({ url: 'https://host.test/old-token' });
  });
  it('keeps the original identity when the caller DTO changes in place during admission', async () => {
    const expected = job();
    const create = vi.fn();
    const start = async () => {
      if (await admittedNavigationJob(expected, async () => {
        expected.source_generation = 8;
        expected.navigation_url = 'https://host.test/new-token';
        expected.navigation_scope!.claim_generation = 4;
        return true;
      }, async () => ({ jobs: [structuredClone(expected)] })))
        create({ url: expected.navigation_url });
    };
    await expect(start()).rejects.toThrow('changed during admission');
    expect(create).not.toHaveBeenCalled();
  });
  it('does not read snapshot without admission', async () => {
    const snapshot = vi.fn();
    expect(await admittedNavigationJob(job(), async () => false, snapshot)).toBe(false);
    expect(snapshot).not.toHaveBeenCalled();
  });
});
