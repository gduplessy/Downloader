import { writeFile } from 'node:fs/promises';

// Diagnostic runs only: preserve the original call, arguments, promise and callback semantics.
export const installResolverTrace = `(() => {
  if (globalThis.__navWaitTrace || !globalThis.chrome?.runtime?.sendMessage) return false;
  const trace = globalThis.__navWaitTrace = [];
  const original = chrome.runtime.sendMessage;
  const summary = value => value == null ? value : {
    click: value.click, direct: value.direct, repeat: value.repeat,
    authorization_present: !!value.authorization,
    documentId: value.documentId, sourceGeneration: value.sourceGeneration,
    tabId: value.tabId, frameId: value.frameId,
    error: typeof value.error === 'string' ? value.error : undefined,
    scope: value.scope ? {claim_generation:value.scope.claim_generation, private:value.scope.private, store_id:value.scope.store_id} : undefined,
  };
  chrome.runtime.sendMessage = function(...args) {
    const message = args.find(v => v && typeof v === 'object' && typeof v.type === 'string');
    if (!['resolver_context','resolver_step','resolver_commit','resolver_abort'].includes(message?.type))
      return Reflect.apply(original, this, args);
    const row = {at:Date.now(), type:message.type, decision:message.decision?.kind,
      document:message.document, binding:message.binding ? {
        sourceGeneration:message.binding.sourceGeneration,
        documentGeneration:message.binding.documentGeneration,
        documentNonce:message.binding.documentNonce,
        fingerprint:message.binding.fingerprint,
      } : undefined};
    trace.push(row); if (trace.length > 500) trace.shift();
    const emit = () => globalThis.__navWaitEmit?.(JSON.stringify(row));
    const finish = value => {row.finished=Date.now();row.response=summary(value);emit();};
    emit();
    const index = args.length - 1;
    if (typeof args[index] === 'function') {
      const callback=args[index]; args[index]=function(...values) {
        row.lastError=chrome.runtime.lastError?.message;finish(values[0]);
        return Reflect.apply(callback,this,values);
      };
    }
    try {
      const result=Reflect.apply(original,this,args);
      if (result?.then) result.then(finish,error=>{row.finished=Date.now();row.rejected=String(error);emit();});
      return result;
    } catch(error) {row.rejected=String(error);emit();throw error;}
  };
  return true;
})()`;

export async function saveFailure(path, details) {
  await writeFile(path, JSON.stringify(details, null, 2) + '\n');
}
