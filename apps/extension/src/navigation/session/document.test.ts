import { describe, it, expect } from 'vitest';
import { verifyLiveDocument } from './document';
const nonce = 'c3b45e0f-227f-41fc-b9c5-af170af9a65d';
describe('live isolated document identity', () => {
  it('rejects old nonce after same-URL reload and document mismatch', async () => {
    const api = {
      scripting: {
        executeScript: async () => [{ frameId: 0, result: nonce, documentId: 'new-document' }],
      },
    };
    expect(
      await verifyLiveDocument(api, 'chromium', 1, { nonce, generation: 1 }, 'new-document'),
    ).toEqual({ nonce, documentId: 'new-document' });
    expect(
      await verifyLiveDocument(api, 'chromium', 1, { nonce, generation: 1 }, 'old-document'),
    ).toBeNull();
    expect(
      await verifyLiveDocument(
        api,
        'chromium',
        1,
        { nonce: '019b0c41-8226-477f-8f3f-bc9f8eeb079d', generation: 1 },
        'new-document',
      ),
    ).toBeNull();
  });
  it('requires a current marker even when documentId is unavailable', async () => {
    const api = { tabs: { executeScript: async () => [nonce] } };
    expect(await verifyLiveDocument(api, 'firefox', 1, { nonce, generation: 1 })).toEqual({
      nonce,
    });
    expect(await verifyLiveDocument(api, 'firefox', 1, { nonce, generation: 0 })).toBeNull();
    expect(
      await verifyLiveDocument(api, 'firefox', 1, { nonce: 'missing', generation: 1 }),
    ).toBeNull();
  });
});
