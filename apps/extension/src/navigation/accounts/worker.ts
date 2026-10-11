import type { AccountAction, AccountBinding } from './types';
import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { matchAdapter } from '../adapters/policy';
export type OwnedAccountTab = {jobId:string;owner:string;scope:SessionScope;sourceGeneration:number;tabId:number;frameId:number;documentId:string|null;page:string};
export async function accountRequest(action: AccountAction, binding: AccountBinding, owned: OwnedAccountTab, native: (command:string,args:unknown)=>Promise<unknown>) {
  const adapter = matchAdapter(owned.page);
  if (binding.tabId !== owned.tabId || binding.frameId !== 0 || owned.frameId !== 0 || binding.documentId !== owned.documentId || binding.page !== owned.page || JSON.stringify(binding.scope) !== JSON.stringify(owned.scope) || binding.sourceGeneration !== owned.sourceGeneration || binding.adapterId !== adapter.id || binding.adapterVersion !== adapter.version) throw Error('account_binding_stale');
  if (action.action !== 'selection') {
    const p=action.proof;
    if (p.tab_id !== owned.tabId || p.frame_id !== 0 || p.page !== owned.page || p.origin !== new URL(owned.page).origin || p.adapter_id !== adapter.id || p.adapter_version !== adapter.version || p.document_id !== binding.documentId || p.document_generation !== binding.documentGeneration) throw Error('account_form_binding_stale');
  }
  return native('browser_account',{job_id:owned.jobId,owner:owned.owner,scope:owned.scope,source_generation:owned.sourceGeneration,request:action});
}
