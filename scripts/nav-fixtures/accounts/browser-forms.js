return (async()=>{
 const api=window.navAccounts;
 const binding={tabId:7,frameId:0,scope:{browser:'chromium',profile:'5bba4f87-daf7-4fd9-8212-03bc3d444e89',private:false,cookie_store_id:'0',container_id:null,partition_key:null,claim_generation:2},sourceGeneration:2,documentGeneration:1,documentId:null,page:location.href,adapterId:'local-fixture',adapterVersion:'1.0.0'};
 const form=await api.supportedForm(document,binding);if(!form)throw Error('visible qualified form missing');
 const counts={normal:0,cancelBeforeGrant:0,cancelDuringGrant:0,changedClaim:0,changedForm:0};
 const originalSubmit=form.form.requestSubmit;
 form.form.requestSubmit=()=>{counts.normal++;};
 async function run(kind){const abort=new AbortController();let grantCalls=0,consumeCalls=0;let current=binding;form.username.value='';form.password.value='';
  if(kind==='before')abort.abort();
  const transport=async action=>{if(action.action==='grant'){grantCalls++;if(kind==='during')abort.abort();return {grant_id:'fixture-one-use',expires_at:Date.now()+10000};}consumeCalls++;if(kind==='claim')current={...binding,scope:{...binding.scope,claim_generation:3}};if(kind==='form')form.form.setAttribute('hidden','');return {username:'alice',password:'fixture-only',expires_at:Date.now()+10000};};
  try{await api.fillOnce(document,binding,form,abort.signal,async()=>current,transport);if(kind!=='normal')throw Error('unexpected submit');}catch(e){if(kind==='normal')throw e;}
  if(kind!=='normal'&&(form.username.value||form.password.value))throw Error('stale or cancelled fill leaked into DOM');
  form.form.removeAttribute('hidden');
  return {grantCalls,consumeCalls};
 }
 await run('normal');const before=await run('before');if(before.grantCalls!==0)throw Error('cancel before grant');counts.cancelBeforeGrant++;
 const during=await run('during');if(during.consumeCalls!==0)throw Error('cancel during grant');counts.cancelDuringGrant++;
 await run('claim');counts.changedClaim++;await run('form');counts.changedForm++;
 form.submitter.setAttribute('formaction','http://localhost:18784/login');if(await api.supportedForm(document,binding))throw Error('submitter override accepted');form.submitter.removeAttribute('formaction');
 if(counts.normal!==1)throw Error('normal once-only submission failed');form.form.requestSubmit=originalSubmit;
 return {fixture:'nav-account-client-dom-v1',browser:navigator.userAgent,outcome:'passed',counts,transport:'explicit mocked account grant; native keyring and installed-extension acceptance recorded separately'};
})()
