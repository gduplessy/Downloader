import { accountLabel } from './labels';
import type { Selection, AccountBinding, AccountAction } from './types';
import { accountDecision } from './policy';
import { fillOnce, supportedForm } from './forms';
export async function showAccountPanel(doc:Document,selection:Selection,binding:AccountBinding,locale:string,context:()=>Promise<AccountBinding|null>,request:(action:AccountAction,binding:AccountBinding)=>Promise<any>):Promise<{close:()=>void}> {
 const abort=new AbortController();const box=doc.createElement('section');box.setAttribute('role','region');box.setAttribute('aria-label',accountLabel(locale,'title'));box.dataset.downloaderUi='account';
 box.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483646;background:#fff;color:#17212b;padding:16px;max-width:360px;border:2px solid #185ac5;border-radius:8px;font:14px system-ui;';
 const text=doc.createElement('p');text.textContent=accountLabel(locale,'selected')+': '+selection.account.label;box.append(text);
 const state=doc.createElement('p');state.setAttribute('role','status');const decision=accountDecision(selection);state.textContent=accountLabel(locale,decision.reason==='free'?'existing':decision.reason==='premium'?'premium':decision.reason==='manual'?'manual':decision.reason);box.append(state);
 const form=await supportedForm(doc,binding);
 if(form && selection.account.saved_fill && !['mfa_required','rejected'].includes(selection.auth)) {
   const fill=doc.createElement('button');fill.type='button';fill.textContent=accountLabel(locale,'fillNow');box.append(fill);
   fill.onclick=async()=>{fill.disabled=true;try {await fillOnce(doc,binding,form,abort.signal,context,request);}catch {if(!abort.signal.aborted)state.textContent=accountLabel(locale,'stale');}};
 }
 const cancel=doc.createElement('button');cancel.type='button';cancel.textContent=accountLabel(locale,'cancel');cancel.onclick=()=>close();box.append(cancel);
 const previous=doc.activeElement as HTMLElement|null;
 const close=()=>{abort.abort();box.remove();if(previous?.isConnected)previous.focus();};
 box.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();}};
 doc.body.append(box);return {close};
}
