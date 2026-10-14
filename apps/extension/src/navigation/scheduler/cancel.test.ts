import { describe, it, expect, vi } from 'vitest';
import { cancelNavigationTask } from './cancel';
import type { SessionScope } from '../../../../../packages/shared/src/navigation';
const scope: SessionScope = {
  browser: 'chromium',
  profile: 'owner',
  private: false,
  cookie_store_id: '0',
  container_id: null,
  partition_key: null,
  claim_generation: 2,
};
const job = { id: 'job', request_id: 'request', source_generation: 4, navigation_scope: scope };
const record = { tabId: 7, scope, sourceGeneration: 4 };
function actions() {
  return {
    owner: 'owner',
    native: vi.fn().mockResolvedValue({ cancelled: true }),
    owns: vi.fn().mockResolvedValue(true),
    invalidate: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    removeRecord: vi.fn().mockResolvedValue(undefined),
    closeTab: vi.fn().mockResolvedValue(undefined),
  };
}
describe('fenced navigation cancellation', () => {
  it('retains browser source, alarms, reservation and tab when native cancellation rejects', async () => {
    const a = actions();
    a.native.mockRejectedValue(Error('Stale claim'));
    await expect(cancelNavigationTask(job, record, a)).rejects.toThrow('Stale claim');
    for (const fn of [a.invalidate, a.release, a.removeRecord, a.closeTab])
      expect(fn).not.toHaveBeenCalled();
  });
  it('sends full native fence and waits for acknowledgement before any cleanup', async () => {
    const a = actions();
    let acknowledge!: () => void;
    a.native.mockReturnValue(new Promise<void>((r) => (acknowledge = r)));
    const work = cancelNavigationTask(job, record, a);
    await Promise.resolve();
    expect(a.native).toHaveBeenCalledWith('cancel_navigation', {
      id: 'job',
      owner: 'owner',
      scope,
      source_generation: 4,
    });
    expect(a.invalidate).not.toHaveBeenCalled();
    acknowledge();
    await work;
    expect(a.invalidate).toHaveBeenCalledWith(job);
    expect(a.release).toHaveBeenCalledWith('job');
    expect(a.removeRecord).toHaveBeenCalledWith('job');
    expect(a.closeTab).toHaveBeenCalledWith(7);
  });
  it.each(['claim', 'source', 'private', 'tab'] as const)(
    'rejects changed %s authority before native mutation',
    async (kind) => {
      const a = actions(),
        r = structuredClone(record);
      if (kind === 'claim') r.scope.claim_generation++;
      if (kind === 'source') r.sourceGeneration++;
      if (kind === 'private') r.scope.private = true;
      if (kind === 'tab') a.owns.mockResolvedValue(false);
      await expect(cancelNavigationTask(job, r, a)).rejects.toThrow('current owning');
      expect(a.native).not.toHaveBeenCalled();
      expect(a.invalidate).not.toHaveBeenCalled();
    },
  );
  it('retains a tab whose actual session changed while cancellation awaited native acknowledgement', async () => {
    const a = actions();
    a.owns.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await cancelNavigationTask(job, record, a);
    expect(a.closeTab).not.toHaveBeenCalled();
    expect(a.release).toHaveBeenCalled();
  });
  it('uses legacy cancellation only for an unclaimed job and never closes a referenced origin tab', async () => {
    const a = actions();
    await cancelNavigationTask({ ...job, navigation_scope: null }, undefined, a);
    expect(a.native).toHaveBeenCalledWith('cancel', { id: 'job' });
    expect(a.closeTab).not.toHaveBeenCalled();
  });
});
