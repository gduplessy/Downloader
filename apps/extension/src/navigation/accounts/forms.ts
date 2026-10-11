import type { AccountBinding, AccountAction, FormProof } from './types';
import { isVisible } from '../adapters/dom';
export type SupportedForm={form:HTMLFormElement;username:HTMLInputElement;password:HTMLInputElement;submitter:HTMLButtonElement|HTMLInputElement;proof:FormProof};
export async function supportedForm(doc:Document,binding:AccountBinding):Promise<SupportedForm|null> {
  if (binding.frameId !== 0 || binding.adapterId !== 'local-fixture' || binding.adapterVersion !== '1.0.0' || !new URL(binding.page).pathname.startsWith('/nav-adapters/')) return null;
  const forms=Array.from(doc.forms).filter(form=>form.dataset.navLogin === '1' && isVisible(form));
  if (forms.length !== 1) return null;
  const form=forms[0];
  const username=form.querySelector<HTMLInputElement>('input[name="username"]');
  const passwords=form.querySelectorAll<HTMLInputElement>('input[type="password"]');
  const submitters=Array.from(form.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button[type="submit"],input[type="submit"]')).filter(isVisible);
  const password=passwords[0];
  if (!username || passwords.length !== 1 || password.name !== 'password' || !isVisible(username) || !isVisible(password) || username.disabled || password.disabled || username.readOnly || password.readOnly || submitters.length !== 1 || submitters[0].disabled || form.method.toLowerCase() !== 'post') return null;
  const origin=new URL(binding.page).origin;
  const action=new URL(form.action,binding.page);
  if (action.origin !== origin || !action.pathname.endsWith('/login') || action.username || action.password || action.search || action.hash || form.target && form.target !== '_self') return null;
  const payload=JSON.stringify({page:binding.page,action:action.href,method:form.method,id:form.id,username:username.name,password:password.name,submitter:submitters[0].name,fields:Array.from(form.elements).map(el=>({tag:el.tagName,name:(el as HTMLInputElement).name,type:(el as HTMLInputElement).type})),state:doc.querySelector('[data-nav-account-state]')?.getAttribute('data-nav-account-state')});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return {form,username,password,submitter:submitters[0],proof:{tab_id:binding.tabId,frame_id:0,origin,page:binding.page,action:action.href,adapter_id:binding.adapterId,adapter_version:binding.adapterVersion,fingerprint,document_generation:binding.documentGeneration,document_id:binding.documentId,username_name:username.name,password_name:password.name}};
}
function equal(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
export async function fillOnce(doc:Document,initial:AccountBinding,expected:SupportedForm,signal:AbortSignal,context:()=>Promise<AccountBinding|null>,request:(action:AccountAction,binding:AccountBinding)=>Promise<any>) {
  async function current() {
    if (signal.aborted) throw Error('account_cancelled');
    const binding=await context();
    if (signal.aborted || !binding || !equal(binding,initial)) throw Error('account_binding_stale');
    const form=await supportedForm(doc,binding);
    if (signal.aborted || !form || form.form !== expected.form || !equal(form.proof,expected.proof)) throw Error('account_form_stale');
    return form;
  }
  await current();
  const grant=await request({action:'grant',proof:expected.proof},initial);
  await current();
  const credentials=await request({action:'consume',grant_id:grant.grant_id,proof:expected.proof},initial);
  const fresh=await current();
  if (Date.now()>=credentials.expires_at || typeof credentials.username !== 'string' || typeof credentials.password !== 'string') throw Error('account_grant_expired');
  const setter=Object.getOwnPropertyDescriptor(doc.defaultView!.HTMLInputElement.prototype,'value')!.set!;
  try {
    if(signal.aborted) throw Error('account_cancelled');
    setter.call(fresh.username,credentials.username);setter.call(fresh.password,credentials.password);
    fresh.username.dispatchEvent(new Event('input',{bubbles:true}));fresh.password.dispatchEvent(new Event('input',{bubbles:true}));
    if(signal.aborted || !fresh.form.isConnected || !isVisible(fresh.password) || fresh.form.action!==expected.proof.action) throw Error('account_form_stale');
    fresh.form.requestSubmit(fresh.submitter);
  } finally {credentials.password='';credentials.username='';}
}
