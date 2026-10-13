import {expect, it} from 'vitest';
import {orphanedStreamIdentity} from './recovery';
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
