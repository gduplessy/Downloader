import {expect,test,vi} from 'vitest';
import {accountDecision,readSignals} from './policy';
import {accountRequest,type OwnedAccountTab} from './worker';
import {accountLabel,accountLabelKeys} from './labels';
import {inspectCandidates,type Control} from '../adapters/policy';
import type {AccountBinding,Selection} from './types';
const scope={browser:'chromium' as const,profile:'b4d1b165-f2bd-4b94-8314-b2b831fb1193',private:false,cookie_store_id:'0',container_id:null,partition_key:null,claim_generation:3};
const page='http://127.0.0.1:18783/nav-adapters/ddownload/account';
const selected:Selection={account:{id:'id',label:'Alice',origin:new URL(page).origin,provider:'local-fixture',account_id:'alice',scope,saved_fill:false,credential_ref:null},scope,mode:'premium',source_generation:2,auth:'authenticated',entitlement:'active',observed_at:10000,selected_host:'ddownload.com'};
const binding:AccountBinding={tabId:12,frameId:0,scope,sourceGeneration:2,documentGeneration:1,documentId:'document-1',page,adapterId:'local-fixture',adapterVersion:'1.0.0'};
const owned:OwnedAccountTab={jobId:'job',owner:scope.profile,scope,sourceGeneration:2,tabId:12,frameId:0,documentId:'document-1',page};
test('entitlement fails closed on expiry/MFA/quota/wrong account/live unqualified provider',()=>{
 expect(accountDecision(selected,11000).premium).toBe(true);
 for(const changed of [{observed_at:1},{auth:'expired' as const},{auth:'mfa_required' as const},{auth:'rejected' as const},{entitlement:'expired' as const},{entitlement:'quota_exhausted' as const},{entitlement:'unknown' as const},{account:{...selected.account,provider:'ddownload'}},{mode:'manual' as const}]) expect(accountDecision({...selected,...changed},100000).premium).toBe(false);
 expect(readSignals({querySelector:()=>({dataset:{navAccountState:'authenticated',navAccountId:'bob',navEntitlement:'active'}})} as unknown as Document,'alice')).toMatchObject({auth:'unknown',entitlement:'unknown'});
});
test('worker only forwards exact owned tab/frame/document/source/session',async()=>{
 const native=vi.fn(async()=>selected);
 await accountRequest({action:'selection'},binding,owned,native);expect(native).toHaveBeenCalledOnce();
 for(const changed of [{tabId:13},{frameId:1},{documentId:'other'},{sourceGeneration:1},{scope:{...scope,private:true}},{scope:{...scope,container_id:'other'}},{scope:{...scope,claim_generation:2}},{page:'http://127.0.0.1:18783/nav-adapters/ddownload/redirect'},{adapterVersion:'2.0.0'}]) await expect(accountRequest({action:'selection'},{...binding,...changed},owned,native)).rejects.toThrow('account_binding_stale');
 expect(native).toHaveBeenCalledOnce();
});
test('premium download requires qualified selected-session evidence and rejects purchase/ads',()=>{
 const premium:Control={localId:'p',text:'Premium download',href:page+'/file.bin',target:page+'/file.bin',action:'link',visible:true,disabled:false,download:true,order:0,fixture:true,premium:true};
 expect(inspectCandidates(page,[premium]).selected).toBeUndefined();
 expect(inspectCandidates(page,[premium],{allowPremium:true}).selected?.localId).toBe('p');
 for(const changed of [{text:'Buy premium'},{contextualText:'advertisement sponsor'},{fixture:false},{panelHost:'rapidgator.net'}]) expect(inspectCandidates(page,[{...premium,...changed}],{allowPremium:true,selectedHost:'ddownload.com'}).selected).toBeUndefined();
 expect(inspectCandidates('https://ddownload.com/page',[premium],{allowPremium:true}).selected).toBeUndefined();
});
test('six complete locale dictionaries render every account state and control',()=>{
 for(const locale of ['en','fr','es','de','ar','zh-CN']) for(const key of accountLabelKeys) expect(accountLabel(locale,key).trim()).not.toBe('');
});
