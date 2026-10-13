import { describe, expect, it } from 'vitest';
import { DirectCaptureOwners } from './ownership';
import type { StreamIdentity } from '../../../../../packages/shared/src/navigation';
describe('direct response ownership versus download observers', () => {
  const identity: StreamIdentity = {stream_id: 'original', source_generation: 2,
    scope: {browser: 'firefox', profile: crypto.randomUUID(), private: false,
      cookie_store_id: 'firefox-container-1', container_id: '1', partition_key: null, claim_generation: 3}};
  it('only suppresses legacy handling for the exact live tab/job/session/source', () => {
    const owners = new DirectCaptureOwners();
    owners.assign(7, 'job', identity);
    expect(owners.owns(7, 'job', identity.scope, 2)).toBe(true);
    expect(owners.owns(8, 'job', identity.scope, 2)).toBe(false);
    expect(owners.owns(7, 'other', identity.scope, 2)).toBe(false);
    expect(owners.owns(7, 'job', identity.scope, 3)).toBe(false);
    for (const scope of [{...identity.scope, private: true}, {...identity.scope, claim_generation: 4},
      {...identity.scope, cookie_store_id: 'firefox-default', container_id: null}])
      expect(owners.owns(7, 'job', scope, 2)).toBe(false);
    owners.release(7, 'original');
    expect(owners.owns(7, 'job', identity.scope, 2)).toBe(false);
  });
  it('a late terminal callback cannot release a replacement stream', () => {
    const owners = new DirectCaptureOwners();
    owners.assign(7, 'job', identity);
    owners.assign(7, 'job', {...identity, stream_id: 'replacement'});
    owners.release(7, 'original');
    expect(owners.owns(7, 'job', identity.scope, 2)).toBe(true);
  });
});
