import { describe, it, expect } from 'vitest';
import { challengeHandler, type ChallengeDependencies } from './worker';
import type { ChallengeBinding } from './lifecycle';
const initial: ChallengeBinding = {
  scope: {
    browser: 'chromium',
    profile: 'c3b45e0f-227f-41fc-b9c5-af170af9a65d',
    private: false,
    cookie_store_id: null,
    container_id: null,
    partition_key: null,
    claim_generation: 1,
  },
  sourceGeneration: 1,
  documentGeneration: 2,
  page: 'https://g4u.to/file',
  selectedHost: 'gofile.io',
  imageDigest: 'a'.repeat(64),
  csrfDigest: 'b'.repeat(64),
  formDigest: 'c'.repeat(64),
  expiresAt: 10000,
};
const sender = { tabId: 5, frameId: 0, page: initial.page };
function dependencies() {
  let alive = true,
    calls = 0;
  const deps: ChallengeDependencies = {
    owned: async () =>
      alive
        ? {
            tabId: 5,
            frameId: 0,
            scope: initial.scope,
            sourceGeneration: 1,
            documentGeneration: 2,
            page: initial.page,
            selectedHost: 'gofile.io',
          }
        : null,
    authorizeSite: async () => true,
    native: async (args) => {
      calls++;
      return args;
    },
    jobId: async () => 'job',
    now: () => 1,
  };
  return {
    deps,
    kill: () => {
      alive = false;
    },
    calls: () => calls,
  };
}
describe('owned challenge worker', () => {
  it('allows one authorization only', async () => {
    const { deps } = dependencies(),
      worker = challengeHandler(deps);
    expect(await worker.authorize(sender, initial)).toBe(true);
    expect(await worker.authorize(sender, initial)).toBe(false);
  });
  it('denies wrong frame, page, source, host, claim and expiry', async () => {
    const { deps } = dependencies(),
      worker = challengeHandler(deps);
    for (const binding of [
      { ...initial, sourceGeneration: 2 },
      { ...initial, documentGeneration: 3 },
      { ...initial, selectedHost: 'ddownload.com' },
      { ...initial, scope: { ...initial.scope, claim_generation: 2 } },
      { ...initial, expiresAt: 0 },
    ])
      await expect(worker.authorize(sender, binding)).rejects.toThrow('session');
    await expect(worker.authorize({ ...sender, frameId: 1 }, initial)).rejects.toThrow('session');
    await expect(
      worker.authorize({ ...sender, page: 'https://other.test' }, initial),
    ).rejects.toThrow('session');
  });
  it('rechecks ownership after async admission', async () => {
    const state = dependencies();
    state.deps.authorizeSite = async () => {
      state.kill();
      return true;
    };
    await expect(challengeHandler(state.deps).authorize(sender, initial)).rejects.toThrow(
      'session',
    );
  });
  it('passes exact native fences and compatible payload only', async () => {
    const state = dependencies(),
      worker = challengeHandler(state.deps);
    const result = await worker.paid(sender, initial, {
      action: 'start',
      image: {
        image_base64: 'image',
        instruction: 'Click the open circle',
        width: 100,
        height: 100,
      },
    });
    expect(result.scope).toEqual(initial.scope);
    expect(result.source_generation).toBe(1);
    expect(result.request.image.binding).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      worker.paid(sender, initial, {
        action: 'start',
        image: {
          image_base64: 'image',
          instruction: 'HTML and session secrets',
          width: 100,
          height: 100,
        },
      }),
    ).rejects.toThrow('invalid_image');
    expect(state.calls()).toBe(1);
  });
});
