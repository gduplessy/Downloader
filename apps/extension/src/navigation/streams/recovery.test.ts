import {expect, it, vi} from 'vitest';
import {orphanedStreamIdentity, recoverStreamAbort} from './recovery';
const scope = {browser:'chromium', profile:crypto.randomUUID(), private:false,
  cookie_store_id:'0', container_id:null, partition_key:null, claim_generation:1};
const capture = {state:'streaming', scope, tabId:3, sourceGeneration:1, streamId:crypto.randomUUID()};
const record = {scope, tabId:3, sourceGeneration:1, sessionEpoch:'current'};
const job = {state:'browser_downloading', browser_source:true, navigation_scope:scope,
  source_generation:1, navigation_owner:scope.profile};
it('recovers only an exact current orphan and refuses completed or replaced transfers', () => {
  expect(orphanedStreamIdentity(capture, record, job, 'current')).toMatchObject({
    stream_id:capture.streamId, source_generation:1,
  });
  for (const changed of [
    {...job, state:'complete'}, {...job, state:'cancelled'}, {...job, source_generation:2},
    {...job, navigation_owner:crypto.randomUUID()},
    {...job, navigation_scope:{...scope, claim_generation:2}},
    {...job, navigation_scope:{...scope, private:true}},
    {...job, navigation_scope:{...scope, cookie_store_id:'1'}},
    {...job, navigation_scope:{...scope, partition_key:{top_level_site:'https://other.test'}}},
  ]) expect(orphanedStreamIdentity(capture, record, changed, 'current')).toBeNull();
  expect(orphanedStreamIdentity(capture, record, job, 'new-browser')).toBeNull();
  expect(orphanedStreamIdentity({...capture, tabId:4}, record, job, 'current')).toBeNull();
  expect(orphanedStreamIdentity({...capture, streamId:'unknown'}, record, job, 'current')).toBeNull();
});

it.each(['interrupted', 'detached'])('retries the exact %s reader abort after native downtime without replay', async state => {
  const marker = {...capture, state};
  const identity = orphanedStreamIdentity(marker, record, job, 'current')!;
  expect(identity).not.toBeNull();
  const abort = vi.fn().mockRejectedValueOnce(Error('service disconnected')).mockResolvedValueOnce({terminal:true});
  await expect(recoverStreamAbort(marker, identity, abort)).rejects.toThrow('service disconnected');
  await recoverStreamAbort(marker, identity, abort);
  expect(abort.mock.calls).toEqual([[identity], [identity]]);
  for (const changed of [{...job, state:'waiting_user'}, {...job, state:'complete'},
    {...job, source_generation:2}, {...job, navigation_scope:{...scope, cookie_store_id:'other'}},
    {...job, navigation_scope:{...scope, private:true}}])
    expect(orphanedStreamIdentity(marker, record, changed, 'current')).toBeNull();
  expect(orphanedStreamIdentity(marker, record, job, 'new-browser')).toBeNull();
});
it('retains zero-byte armed response recovery when no checkpoint was admitted', async () => {
  const abort = vi.fn().mockRejectedValue(Error('Browser stream not begun'));
  await expect(recoverStreamAbort({state:'armed'}, {stream_id:capture.streamId, scope, source_generation:1}, abort, 'waiting_browser'))
    .resolves.toBeUndefined();
});

it.each(['streaming', 'taking_original_response'])('keeps %s recovery retryable when native abort is rejected', async state => {
  const identity = {stream_id:capture.streamId, scope, source_generation:1};
  const abort = vi.fn().mockRejectedValue(Error('Stale or foreign browser stream ownership'));
  await expect(recoverStreamAbort({state}, identity, abort)).rejects.toThrow('Stale or foreign');
});

it('does not mistake an armed service outage for an absent checkpoint', async () => {
  const abort = vi.fn().mockRejectedValue(Error('service disconnected'));
  await expect(recoverStreamAbort({state:'armed'}, {stream_id:capture.streamId, scope, source_generation:1}, abort))
    .rejects.toThrow('service disconnected');
});

it('requires native abort even for an armed marker once native progress is active', async () => {
  const abort = vi.fn().mockRejectedValue(Error('Browser stream not begun'));
  await expect(recoverStreamAbort({state:'armed'}, {stream_id:capture.streamId, scope, source_generation:1}, abort, 'browser_downloading'))
    .rejects.toThrow('Browser stream not begun');
});
