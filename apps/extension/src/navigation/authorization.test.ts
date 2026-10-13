import { describe, expect, it } from 'vitest';
import { NavigationAuthorizations, type NavigationAuthorizationBinding } from './authorization';

const binding: NavigationAuthorizationBinding = {
  tabId: 7,
  frameId: 0,
  documentId: 'document-one',
  page: 'https://example.test/file',
  scope: {
    browser: 'chromium',
    profile: '11111111-1111-4111-8111-111111111111',
    private: false,
    cookie_store_id: '0',
    container_id: null,
    partition_key: { top_level_site: 'https://example.test' },
    claim_generation: 3,
  },
  sourceGeneration: 4,
  documentGeneration: 1,
  documentNonce: 'c3b45e0f-227f-41fc-b9c5-af170af9a65d',
  adapterId: 'generic',
  adapterVersion: '1.0.0',
  fingerprint: 'a'.repeat(64),
};
const action = { url: 'https://example.test/one-use', method: 'POST' };

describe('one-use navigation authorization', () => {
  it('prepares without side effects and consumes once', () => {
    const grants = new NavigationAuthorizations();
    const token = grants.issue(binding, action);
    expect(grants.consume(token, structuredClone(binding))).toEqual(action);
    expect(() => grants.consume(token, binding)).toThrow('stale');
  });
  it('rejects every changed authority or inspected document', () => {
    const variants = [
      { tabId: 8 },
      { frameId: 1 },
      { documentId: 'document-two' },
      { documentNonce: '5d7d0285-d238-4d6a-9661-6a5446851c7f' },
      { page: 'https://example.test/changed' },
      { sourceGeneration: 5 },
      { documentGeneration: 2 },
      { documentNonce: '33333333-3333-4333-8333-333333333333' },
      { adapterVersion: '2.0.0' },
      { fingerprint: 'b'.repeat(64) },
      { scope: { ...binding.scope, claim_generation: 4 } },
      { scope: { ...binding.scope, cookie_store_id: '1' } },
      { scope: { ...binding.scope, private: true } },
      { scope: { ...binding.scope, partition_key: { top_level_site: 'https://other.test' } } },
    ];
    for (const variant of variants) {
      const grants = new NavigationAuthorizations();
      const token = grants.issue(binding, action);
      expect(() => grants.consume(token, { ...binding, ...variant })).toThrow('stale');
      expect(() => grants.consume(token, binding)).toThrow('stale');
    }
  });
  it('consumes an old Firefox token when the same URL reloads with a new nonce', () => {
    const grants = new NavigationAuthorizations();
    const firefox = {
      ...binding,
      documentId: undefined,
      scope: { ...binding.scope, browser: 'firefox' as const },
    };
    const token = grants.issue(firefox, action);
    expect(() =>
      grants.consume(token, { ...firefox, documentNonce: '33333333-3333-4333-8333-333333333333' }),
    ).toThrow('stale');
    expect(() => grants.consume(token, firefox)).toThrow('stale');
  });
  it('retains the prepared provider choice until consume', () => {
    const grants = new NavigationAuthorizations();
    const prepared = { ...action, selectedHost: 'ddownload.com' };
    const token = grants.issue(binding, prepared);
    prepared.selectedHost = 'gofile.io';
    expect(grants.consume(token, binding).selectedHost).toBe('ddownload.com');
  });
  it('expires and cancels pending authorization', () => {
    let now = 0;
    const grants = new NavigationAuthorizations(() => now, 100);
    const expired = grants.issue(binding, action);
    now = 100;
    expect(() => grants.consume(expired, binding)).toThrow('stale');
    const cancelled = grants.issue(binding, action);
    grants.cancel(cancelled);
    expect(() => grants.consume(cancelled, binding)).toThrow('stale');
  });
  it('invalidates all pending grants on tab replacement', () => {
    const grants = new NavigationAuthorizations();
    const token = grants.issue(binding, action);
    const other = grants.issue({ ...binding, tabId: 8 }, action);
    grants.invalidateTab(7);
    expect(() => grants.consume(token, binding)).toThrow('stale');
    expect(grants.consume(other, { ...binding, tabId: 8 })).toEqual(action);
  });
  it('rejects foreign blobs and unsafe action schemes', () => {
    const grants = new NavigationAuthorizations();
    for (const url of [
      'blob:https://other.test/id',
      'javascript:alert(1)',
      'https://u:p@example.test/',
    ])
      expect(() => grants.issue(binding, { ...action, url })).toThrow('invalid');
    const url = 'blob:https://example.test/local';
    expect(grants.consume(grants.issue(binding, { url, method: 'GET' }), binding)).toEqual({
      url,
      method: 'GET',
    });
  });
});
