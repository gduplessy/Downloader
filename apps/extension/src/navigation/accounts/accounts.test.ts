import { validateAccountDocument } from './document';
import { PremiumAuthorizations } from './premium';
import { expect, test, vi } from 'vitest';
import { accountDecision, readSignals } from './policy';
import { accountRequest, type OwnedAccountTab } from './worker';
import { sameAccountBinding } from './binding';
import { accountLabel, accountLabelKeys } from './labels';
import { inspectCandidates, type Control } from '../adapters/policy';
import type { AccountBinding, Selection } from './types';
const scope = {
  browser: 'chromium' as const,
  profile: 'b4d1b165-f2bd-4b94-8314-b2b831fb1193',
  private: false,
  cookie_store_id: '0',
  container_id: null,
  partition_key: null,
  claim_generation: 3,
};
const page = 'http://127.0.0.1:18783/nav-adapters/ddownload/account';
const selected: Selection = {
  account: {
    revision: 1,
    id: 'id',
    label: 'Alice',
    origin: new URL(page).origin,
    provider: 'local-fixture',
    account_id: 'alice',
    scope,
    saved_fill: false,
    credential_ref: null,
  },
  scope,
  mode: 'premium',
  source_generation: 2,
  auth: 'authenticated',
  entitlement: 'active',
  observed_at: 10000,
  selected_host: 'ddownload.com',
};
const binding: AccountBinding = {
  tabId: 12,
  frameId: 0,
  scope,
  sourceGeneration: 2,
  documentGeneration: 1,
  documentNonce: 'c3b45e0f-227f-41fc-b9c5-af170af9a65d',
  documentId: 'document-1',
  page,
  adapterId: 'local-fixture',
  adapterVersion: '1.0.0',
};
const owned: OwnedAccountTab = {
  jobId: 'job',
  owner: scope.profile,
  scope,
  sourceGeneration: 2,
  tabId: 12,
  frameId: 0,
  documentId: 'document-1',
  documentNonce: 'c3b45e0f-227f-41fc-b9c5-af170af9a65d',
  page,
};
test('entitlement fails closed on expiry/MFA/quota/wrong account/live unqualified provider', () => {
  expect(accountDecision(selected, 11000).premium).toBe(true);
  for (const changed of [
    { observed_at: 1 },
    { auth: 'expired' as const },
    { auth: 'mfa_required' as const },
    { auth: 'rejected' as const },
    { entitlement: 'expired' as const },
    { entitlement: 'quota_exhausted' as const },
    { entitlement: 'unknown' as const },
    { account: { ...selected.account, provider: 'ddownload' } },
    { mode: 'manual' as const },
  ])
    expect(accountDecision({ ...selected, ...changed }, 100000).premium).toBe(false);
  expect(
    readSignals(
      {
        querySelector: () => ({
          dataset: {
            navAccountState: 'authenticated',
            navAccountId: 'bob',
            navEntitlement: 'active',
          },
        }),
      } as unknown as Document,
      'alice',
    ),
  ).toMatchObject({ auth: 'account_mismatch', entitlement: 'unknown' });
});
test('worker only forwards exact owned tab/frame/document/source/session', async () => {
  const native = vi.fn(async () => selected);
  await accountRequest({ action: 'selection' }, binding, owned, native);
  expect(native).toHaveBeenCalledOnce();
  for (const changed of [
    { tabId: 13 },
    { frameId: 1 },
    { documentId: 'other' },
    { documentNonce: 'same-url-new-document' },
    { sourceGeneration: 1 },
    { scope: { ...scope, private: true } },
    { scope: { ...scope, container_id: 'other' } },
    { scope: { ...scope, claim_generation: 2 } },
    { page: 'http://127.0.0.1:18783/nav-adapters/ddownload/redirect' },
    { adapterVersion: '2.0.0' },
  ])
    await expect(
      accountRequest({ action: 'selection' }, { ...binding, ...changed }, owned, native),
    ).rejects.toThrow('account_binding_stale');
  expect(native).toHaveBeenCalledOnce();
});
test('premium download requires qualified selected-session evidence and rejects purchase/ads', () => {
  const premium: Control = {
    localId: 'p',
    text: 'Premium download',
    href: page + '/file.bin',
    target: page + '/file.bin',
    action: 'link',
    visible: true,
    disabled: false,
    download: true,
    order: 0,
    fixture: true,
    premium: true,
  };
  expect(inspectCandidates(page, [premium]).selected).toBeUndefined();
  expect(inspectCandidates(page, [premium], { allowPremium: true }).selected?.localId).toBe('p');
  for (const changed of [
    { text: 'Buy premium' },
    { contextualText: 'advertisement sponsor' },
    { fixture: false },
    { panelHost: 'rapidgator.net' },
  ])
    expect(
      inspectCandidates(page, [{ ...premium, ...changed }], {
        allowPremium: true,
        selectedHost: 'ddownload.com',
      }).selected,
    ).toBeUndefined();
  expect(
    inspectCandidates('https://ddownload.com/page', [premium], { allowPremium: true }).selected,
  ).toBeUndefined();
});
test('six complete locale dictionaries render every account state and control', () => {
  for (const locale of ['en', 'fr', 'es', 'de', 'ar', 'zh-CN'])
    for (const key of accountLabelKeys) expect(accountLabel(locale, key).trim()).not.toBe('');
});

test('authority equality is structural across JSON field ordering', () => {
  const reordered = {
    ...binding,
    scope: {
      claim_generation: scope.claim_generation,
      partition_key: null,
      container_id: null,
      cookie_store_id: '0',
      private: false,
      profile: scope.profile,
      browser: 'chromium' as const,
    },
  };
  expect(sameAccountBinding(binding, reordered)).toBe(true);
  expect(
    sameAccountBinding(binding, {
      ...reordered,
      scope: { ...reordered.scope, claim_generation: 2 },
    }),
  ).toBe(false);
});

test('premium commit consumes once and rejects expiry/account edits/quota/cancellation', () => {
  let now = 11000;
  const claims = new PremiumAuthorizations(() => now);
  claims.issue('normal', 12, selected);
  expect(claims.consume('normal', 12, selected)).toBe(true);
  expect(claims.consume('normal', 12, selected)).toBe(false);
  for (const changed of [
    { ...selected, account: { ...selected.account, revision: 2 } },
    { ...selected, entitlement: 'quota_exhausted' as const },
    null,
  ]) {
    claims.issue('changed', 12, selected);
    expect(() => claims.consume('changed', 12, changed)).toThrow('account_premium_stale');
  }
  claims.issue('expiry', 12, selected);
  now += 15001;
  expect(() => claims.consume('expiry', 12, selected)).toThrow();
  now = 11000;
  claims.issue('cancel', 12, selected);
  claims.invalidateTab(12);
  expect(claims.has('cancel')).toBe(false);
});

test('queued old document messages cannot replace actual current top-frame identity', async () => {
  const api = {
    tabs: { get: async () => ({ status: 'complete', url: page }) },
    scripting: {
      executeScript: async () => [{ frameId: 0, documentId: 'new-document', result: page }],
    },
  };
  await expect(validateAccountDocument(api, 'chromium', 12, 'old-document')).rejects.toThrow(
    'account_document_stale',
  );
  expect(await validateAccountDocument(api, 'chromium', 12, 'new-document')).toBe(page);
  await expect(
    validateAccountDocument(
      {
        ...api,
        scripting: {
          executeScript: async () => [{ frameId: 1, documentId: 'new-document', result: page }],
        },
      },
      'chromium',
      12,
      'new-document',
    ),
  ).rejects.toThrow();
});

test('same URL replacement needs the current nonce even when sender document ID is unavailable', async () => {
  const nonce = 'c3b45e0f-227f-41fc-b9c5-af170af9a65d';
  const api = {
    tabs: {
      get: async () => ({ status: 'complete', url: page }),
      executeScript: async () => [nonce],
    },
  };
  expect(
    await validateAccountDocument(api, 'firefox', 12, undefined, { nonce, generation: 1 }),
  ).toBe(page);
  await expect(
    validateAccountDocument(api, 'firefox', 12, undefined, {
      nonce: '5d7d0285-d238-4d6a-9661-6a5446851c7f',
      generation: 1,
    }),
  ).rejects.toThrow('account_document_stale');
  await expect(validateAccountDocument(api, 'firefox', 12, undefined)).rejects.toThrow(
    'account_document_stale',
  );
});
