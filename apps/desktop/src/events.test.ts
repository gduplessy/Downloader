import { describe, expect, it } from 'vitest';
import { applyEvents } from '../../../packages/shared/src/events';
describe('event reconnects', () => {
  it('requires a snapshot before deltas and for invalidated settings', () => {
    expect(
      applyEvents(null, { snapshot: null, sequence: 1, has_more: false, events: [] }),
    ).toBeNull();
    expect(
      applyEvents(
        { sequence: 1, jobs: [] },
        {
          snapshot: null,
          sequence: 2,
          has_more: false,
          events: [{ sequence: 2, type: 'settings_changed' }],
        },
      ),
    ).toBeNull();
  });
  it('applies lifecycle, progress, deletion and rejects stale replay', () => {
    const start = { sequence: 1, jobs: [{ id: 'a', bytes: 0 }] };
    const next = applyEvents(start, {
      snapshot: null,
      sequence: 3,
      has_more: false,
      events: [
        { type: 'job_progress', sequence: 2, job: { id: 'a', bytes: 12 } as any },
        { type: 'job_lifecycle', sequence: 3, job: { id: 'b' } },
      ],
    })!;
    expect(next.jobs).toEqual([{ id: 'a', bytes: 12 }, { id: 'b' }]);
    expect(applyEvents(next, { snapshot: null, sequence: 1, has_more: false, events: [] })).toBe(
      next,
    );
    expect(
      applyEvents(next, {
        snapshot: null,
        sequence: 4,
        has_more: false,
        events: [{ type: 'job_removed', sequence: 4, id: 'a' }],
      })!.jobs,
    ).toEqual([{ id: 'b' }]);
  });
});
