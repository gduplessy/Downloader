import { describe, expect, it } from 'vitest';
import { ProjectionCursor } from './projection';
import type { SessionScope } from '../../../../../packages/shared/src/navigation';

const scope: SessionScope = {
  browser: 'chromium',
  profile: '11111111-1111-4111-8111-111111111111',
  private: false,
  cookie_store_id: '0',
  container_id: null,
  partition_key: { top_level_site: 'https://example.test', has_cross_site_ancestor: false },
  claim_generation: 1,
};
const projection = { owner: scope.profile, private: false, scopes: [scope] };

describe('authority-qualified event cursor', () => {
  it('recovers newly visible claimed jobs instead of skipping their earlier events', () => {
    const cursor = new ProjectionCursor();
    cursor.accept(cursor.prepare({ ...projection, scopes: [] }, null));
    expect(cursor.prepare(projection, 12).after_sequence).toBeNull();
    const accepted = cursor.prepare(projection, 12);
    cursor.accept(accepted);
    expect(cursor.prepare(projection, 13).after_sequence).toBe(13);
  });

  it('discards cached authority when a scope, claim, profile or privacy lane changes', () => {
    const cursor = new ProjectionCursor();
    cursor.accept(cursor.prepare(projection, null));
    for (const changed of [
      { ...projection, scopes: [] },
      { ...projection, scopes: [{ ...scope, claim_generation: 2 }] },
      { ...projection, scopes: [{ ...scope, cookie_store_id: 'other' }] },
      { ...projection, owner: 'other-profile' },
      { ...projection, private: true },
    ])
      expect(cursor.prepare(changed, 12).after_sequence).toBeNull();
    // Preparing an unsuccessful request never advances the cached authority.
    expect(cursor.prepare(projection, 12).after_sequence).toBe(12);
  });

  it('uses canonical scope identity and ignores scope-list ordering', () => {
    const other = { ...scope, cookie_store_id: '1' };
    const cursor = new ProjectionCursor();
    cursor.accept(cursor.prepare({ ...projection, scopes: [scope, other] }, null));
    expect(
      cursor.prepare(
        {
          ...projection,
          scopes: [
            other,
            {
              ...scope,
              partition_key: {
                has_cross_site_ancestor: false,
                top_level_site: 'https://example.test',
              },
            },
          ],
        },
        12,
      ).after_sequence,
    ).toBe(12);
  });
});
