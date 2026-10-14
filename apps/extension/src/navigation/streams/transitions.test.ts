import { expect, it } from 'vitest';
import { CaptureTransitions, interruptedCaptureMatches } from './transitions';
const scope = {
  browser: 'firefox',
  profile: crypto.randomUUID(),
  private: false,
  cookie_store_id: 'firefox-container-6',
  container_id: 'firefox-container-6',
  partition_key: null,
  claim_generation: 1,
};
const record = { scope, sourceGeneration: 1, documentNonce: 'original-document' };
const marker = { ...record, state: 'interrupted' };
const latch = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
it.each(['scheduler', 'native status'])(
  'interruption follows an in-flight %s write and blocks subsequent navigation',
  async (pause) => {
    const gate = new CaptureTransitions();
    const entered = latch(),
      resume = latch();
    let capture: any = { ...marker, state: 'armed' },
      state = 'waiting_user';
    const effects: string[] = [];
    const step = () =>
      gate.run(3, async () => {
        if (interruptedCaptureMatches(capture, record)) return;
        const scheduler = async () => {
          if (pause === 'scheduler') {
            entered.release();
            await resume.promise;
          }
        };
        const nativeStatus = async () => {
          if (pause === 'native status') {
            entered.release();
            await resume.promise;
          }
          state = 'waiting_browser';
          effects.push('navigation status');
        };
        await scheduler();
        await nativeStatus();
        effects.push('control token');
      });
    const first = step();
    await entered.promise;
    const interrupted = gate.run(3, async () => {
      state = 'waiting_user';
      effects.push('native abort');
      capture = marker;
    });
    const later = step();
    resume.release();
    await Promise.all([first, interrupted, later]);
    expect(state).toBe('waiting_user');
    expect(effects).toEqual(['navigation status', 'control token', 'native abort']);
  },
);
it('releases rejected transitions and does not serialize other tabs', async () => {
  const gate = new CaptureTransitions(),
    hold = latch();
  const failed = gate.run(3, async () => {
    await hold.promise;
    throw Error('service lost');
  });
  await expect(gate.run(4, async () => 'other tab')).resolves.toBe('other tab');
  const next = gate.run(3, async () => 'retry');
  hold.release();
  await expect(failed).rejects.toThrow('service lost');
  await expect(next).resolves.toBe('retry');
});
it('blocks only the exact interrupted action and preserves explicit replacement authority', () => {
  expect(interruptedCaptureMatches(marker, record)).toBe(true);
  expect(interruptedCaptureMatches({ ...marker, state: 'detached' }, record)).toBe(true);
  for (const changed of [
    { ...record, sourceGeneration: 2 },
    { ...record, documentNonce: 'new-document' },
    { ...record, scope: { ...scope, claim_generation: 2 } },
    { ...record, scope: { ...scope, private: true } },
    { ...record, scope: { ...scope, cookie_store_id: 'other' } },
    { ...record, scope: { ...scope, partition_key: { top_level_site: 'https://other.test' } } },
  ])
    expect(interruptedCaptureMatches(marker, changed)).toBe(false);
  expect(interruptedCaptureMatches({ ...marker, state: 'armed' }, record)).toBe(false);
});

it('rejects a pre-issued control token committed after interruption', async () => {
  const gate = new CaptureTransitions(),
    entered = latch(),
    resume = latch();
  let capture: any = { ...marker, state: 'armed' };
  const effects: string[] = [];
  const stop = gate.run(3, async () => {
    entered.release();
    await resume.promise;
    effects.push('native abort');
    capture = marker;
  });
  await entered.promise;
  const commit = gate.run(3, async () => {
    if (interruptedCaptureMatches(capture, record)) throw Error('navigation_authorization_stale');
    effects.push('consume token', 'navigation selection', 'new reader');
  });
  resume.release();
  await stop;
  await expect(commit).rejects.toThrow('navigation_authorization_stale');
  expect(effects).toEqual(['native abort']);
});
