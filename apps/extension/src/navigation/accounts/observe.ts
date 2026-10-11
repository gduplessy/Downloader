import type { AccountAction, AccountBinding, FormProof, Selection } from './types';
import { readSignals } from './policy';
import { supportedForm } from './forms';
export async function observeAccount(
  doc: Document,
  binding: AccountBinding,
  selected: Selection,
  request: (action: AccountAction, binding: AccountBinding) => Promise<any>,
): Promise<Selection> {
  if (selected.account.origin !== new URL(binding.page).origin)
    return { ...selected, auth: 'account_mismatch', entitlement: 'unknown', observed_at: null };
  if (selected.account.provider !== 'local-fixture' || binding.adapterId !== 'local-fixture')
    return { ...selected, auth: 'unknown', entitlement: 'unknown', observed_at: null };
  const signals = readSignals(doc, selected.account.account_id);
  const form = await supportedForm(doc, binding);
  let proof: FormProof;
  if (form) proof = form.proof;
  else {
    const value = JSON.stringify({
      page: binding.page,
      signals,
      account: selected.account.id,
      document: binding.documentGeneration,
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    const fingerprint = Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    proof = {
      tab_id: binding.tabId,
      frame_id: binding.frameId,
      origin: new URL(binding.page).origin,
      page: binding.page,
      action: binding.page,
      method: 'GET',
      adapter_id: binding.adapterId,
      adapter_version: binding.adapterVersion,
      fingerprint,
      document_generation: binding.documentGeneration,
      document_id: binding.documentId,
      username_name: '',
      password_name: '',
    };
  }
  return request(
    { action: 'observe', proof, ...signals, selected_host: selected.selected_host },
    binding,
  );
}
