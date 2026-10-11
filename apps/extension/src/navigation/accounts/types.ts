import type { SessionScope } from '../../../../../packages/shared/src/navigation';
export type AuthState =
  | 'signed_out'
  | 'authenticated'
  | 'expired'
  | 'mfa_required'
  | 'rejected'
  | 'account_mismatch'
  | 'unknown';
export type Entitlement = 'active' | 'expired' | 'quota_exhausted' | 'unknown';
export type Account = {
  id: string;
  label: string;
  origin: string;
  provider: string;
  account_id: string;
  scope: SessionScope;
  saved_fill: boolean;
  credential_ref: string | null;
};
export type Selection = {
  account: Account;
  scope: SessionScope;
  source_generation: number;
  mode: 'free' | 'premium' | 'manual';
  auth: AuthState;
  entitlement: Entitlement;
  observed_at: number | null;
  selected_host: string | null;
};
export type FormProof = {
  tab_id: number;
  frame_id: number;
  origin: string;
  page: string;
  action: string;
  method: string;
  adapter_id: string;
  adapter_version: string;
  fingerprint: string;
  document_generation: number;
  document_id: string | null;
  username_name: string;
  password_name: string;
};
export type AccountBinding = {
  tabId: number;
  frameId: number;
  scope: SessionScope;
  sourceGeneration: number;
  documentGeneration: number;
  documentId: string | null;
  page: string;
  adapterId: string;
  adapterVersion: string;
};
export type AccountAction =
  | { action: 'selection' }
  | {
      action: 'observe';
      proof: FormProof;
      auth: AuthState;
      entitlement: Entitlement;
      account_id: string | null;
      selected_host: string | null;
    }
  | { action: 'grant'; proof: FormProof }
  | { action: 'consume'; grant_id: string; proof: FormProof };
