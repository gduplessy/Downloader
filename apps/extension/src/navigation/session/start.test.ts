import { describe, it, expect } from 'vitest';
import { NavigationStarts } from './start';
describe('owned navigation startup', () => {
  it('one job creates one tab while concurrent jobs retain independent progress', async () => {
    const starts = new NavigationStarts();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let tab: number | undefined;
    let creations = 0;
    const events: string[] = [];
    const first = starts.run('same', async () => {
      events.push('first');
      await gate;
      tab = ++creations;
      return tab;
    });
    const second = starts.run('same', async () => {
      events.push('second');
      if (!tab) tab = ++creations;
      return tab;
    });
    await starts.run('other', async () => events.push('other'));
    expect(events).toEqual(['first', 'other']);
    release();
    expect(await first).toBe(1);
    expect(await second).toBe(1);
    expect(creations).toBe(1);
  });
  it('a failed start does not poison retry or allow later starts to overtake the queued owner', async () => {
    const starts = new NavigationStarts();
    const events: string[] = [];
    const failed = starts.run('job', async () => {
      events.push('failed');
      throw Error('fixture startup refused');
    });
    const retry = starts.run('job', async () => {
      events.push('retry');
      return 2;
    });
    await expect(failed).rejects.toThrow('fixture startup refused');
    expect(await retry).toBe(2);
    expect(events).toEqual(['failed', 'retry']);
  });
});
