import { describe, expect, it } from 'vitest';
import { WaitClock, observeWait, retryAfter, activeBudgetElapsed } from './waits';
describe('durable wait clock', () => {
  it('uses monotonic elapsed through forward and backward wall-clock changes', () => {
    let utc = 1000, mono = 0;
    const clock = new WaitClock({ utc: () => utc, monotonic: () => mono });
    const wait = observeWait(undefined, 1, 60000, utc, 'countdown');
    expect(clock.elapsed('j', wait)).toBe(0);
    utc = -10000; mono = 30000; expect(clock.elapsed('j', wait)).toBe(30000);
    utc = 400000; mono = 60000; expect(clock.due('j', wait)).toBe(true);
  });
  it('restart/sleep past deadline requests revalidation and preserves source generation', () => {
    const wait = observeWait(undefined, 8, 60000, 1000, 'countdown');
    const clock = new WaitClock({ utc: () => 70000, monotonic: () => 0 });
    expect(clock.due('j', wait)).toBe(true); expect(wait.source_generation).toBe(8);
  });
  it('preserves countdown observations and replaces changed timers', () => {
    const first = observeWait(undefined, 1, 60000, 1000, 'countdown');
    expect(observeWait(first, 1, 59000, 2000, 'countdown')).toBe(first);
    expect(observeWait(first, 1, 120000, 2000, 'countdown').generation).toBe(2);
    expect(observeWait(first, 2, 59000, 2000, 'countdown').generation).toBe(2);
  });
  it('bounds Retry-After and excludes long legitimate waits from active budget', () => {
    expect(retryAfter('120', 1000)).toBe(121000); expect(retryAfter('-1', 1000)).toBeNull();
    expect(retryAfter('9999999999', 1000)).toBeNull();
    expect(activeBudgetElapsed(0, 900000, [{ start: 1000, end: 899000 }])).toBe(2000);
  });
});
