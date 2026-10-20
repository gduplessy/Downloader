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
  it('separates primitive private mappings and fences guessed removal or overwrite', async () => {
    const local = memoryStorage(), session = memoryStorage();
    const regular = navigationStorage(local, session, false);
    const privateStore = navigationStorage(local, session, true);
    await privateStore.set({'browser-job-1':'private-job-marker'});
    expect(await regular.get()).toEqual({});
    await regular.remove(['browser-job-1','private-nav:browser-job-1']);
    expect((await privateStore.get())['browser-job-1']).toBe('private-job-marker');
    await expect(regular.set({'private-nav:browser-job-1':'overwrite'})).rejects.toThrow('Private');
    await regular.set({'browser-job-1':{jobId:'regular-job', private:false}});
    await privateStore.remove('browser-job-1');
    expect((await regular.get())['browser-job-1'].jobId).toBe('regular-job');
    const legacy = {scope:{...scope, private:true}, sourceGeneration:1};
    await session.set({'resolver-legacy':legacy, 'browser-job-legacy':'unqualified-marker'});
    expect((await regular.get())['resolver-legacy']).toBeUndefined();
    expect((await regular.get())['browser-job-legacy']).toBeUndefined();
    expect((await privateStore.get())['browser-job-legacy']).toBeUndefined();
    await regular.remove(['resolver-legacy','browser-job-legacy']);
    await expect(regular.set({'resolver-legacy':{scope, sourceGeneration:2}})).rejects.toThrow('Private');
    expect((await session.get())['resolver-legacy']).toEqual(legacy);
    expect((await session.get())['browser-job-legacy']).toBe('unqualified-marker');
    expect(await local.get()).toEqual({});
  });
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


it.each(['single', 'array', 'defaults'] as const)('private %s reads do not enumerate unrelated session authority', async shape => {
  const local = memoryStorage(), backing = memoryStorage();
  const legacy = {scope:{...scope,private:true},sourceGeneration:1,tabId:7};
  const current = {...legacy,sourceGeneration:2};
  await backing.set(Object.fromEntries(Array.from({length:2000},(_,i)=>['private-nav:unrelated-'+i,{private:true,marker:i}])));
  await backing.set({'resolver-target':legacy,'private-nav:resolver-target':current,'unmarked':'regular-value'});
  const reads:string[][]=[];
  const session={...backing,async get(keys?:any){
    if(keys==null) throw Error('Targeted private read enumerated the session store');
    const requested=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys);
    reads.push(requested);
    return backing.get(keys);
  }};
  const store=navigationStorage(local,session,true);
  const keys=shape==='single'?'resolver-target':shape==='array'?['resolver-target','unmarked','missing']:{'resolver-target':null,unmarked:null,missing:null};
  expect(await store.get(keys)).toEqual({'resolver-target':current});
  expect(reads).toHaveLength(1);
  expect(reads[0].length).toBeLessThanOrEqual(shape==='single'?2:6);
  expect(reads[0].some(key=>key.includes('unrelated'))).toBe(false);
  expect(await local.get()).toEqual({});
});

it('private full enumeration keeps legacy filtering and prefixed precedence', async()=>{
  const backing=memoryStorage();
  const legacy={scope:{...scope,private:true},sourceGeneration:1};
  const current={...legacy,sourceGeneration:2};
  await backing.set({'resolver-target':legacy,'private-nav:resolver-target':current,regular:{private:false},primitive:'not-authority','private-nav:profile':'private-profile-id'});
  const store=navigationStorage(memoryStorage(),backing,true);
  expect(await store.get()).toEqual({'resolver-target':current,profile:'private-profile-id'});
  expect(await store.get([])).toEqual({});
});
