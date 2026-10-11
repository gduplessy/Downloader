import type { AuthState, Entitlement, Selection } from './types';
export type AccountDecision = {
  premium: boolean;
  reason:
    | 'free'
    | 'manual'
    | 'login'
    | 'mfa'
    | 'credentials_rejected'
    | 'mismatch'
    | 'expired'
    | 'quota'
    | 'unknown'
    | 'premium';
};
export function accountDecision(selection: Selection | null, now = Date.now()): AccountDecision {
  if (!selection || selection.mode === 'free') return { premium: false, reason: 'free' };
  if (selection.mode === 'manual') return { premium: false, reason: 'manual' };
  if (
    !selection.observed_at ||
    now - selection.observed_at > 90_000 ||
    selection.observed_at > now + 1000
  )
    return { premium: false, reason: 'unknown' };
  if (selection.auth === 'mfa_required') return { premium: false, reason: 'mfa' };
  if (selection.auth === 'account_mismatch') return { premium: false, reason: 'mismatch' };
  if (selection.auth === 'rejected') return { premium: false, reason: 'credentials_rejected' };
  if (selection.auth !== 'authenticated') return { premium: false, reason: 'login' };
  if (selection.entitlement === 'expired') return { premium: false, reason: 'expired' };
  if (selection.entitlement === 'quota_exhausted') return { premium: false, reason: 'quota' };
  if (selection.entitlement !== 'active' || selection.account.provider !== 'local-fixture')
    return { premium: false, reason: 'unknown' };
  return { premium: true, reason: 'premium' };
}
export function readSignals(
  doc: Document,
  selectedAccount: string,
): { auth: AuthState; entitlement: Entitlement; account_id: string | null } {
  const marker = doc.querySelector<HTMLElement>('[data-nav-account-state]');
  if (!marker) return { auth: 'unknown', entitlement: 'unknown', account_id: null };
  const auth = marker.dataset.navAccountState as AuthState;
  const allowedAuth = [
    'signed_out',
    'authenticated',
    'expired',
    'mfa_required',
    'rejected',
    'unknown',
  ];
  const id = marker.dataset.navAccountId ?? null;
  const entitlement = marker.dataset.navEntitlement as Entitlement;
  return {
    auth:
      auth === 'authenticated' && id !== selectedAccount
        ? 'account_mismatch'
        : allowedAuth.includes(auth)
          ? auth
          : 'unknown',
    entitlement:
      auth === 'authenticated' &&
      id === selectedAccount &&
      ['active', 'expired', 'quota_exhausted', 'unknown'].includes(entitlement)
        ? entitlement
        : 'unknown',
    account_id: id,
  };
}
