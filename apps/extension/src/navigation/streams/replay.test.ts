import { describe,it,expect } from 'vitest';
import { classifyReplay,permitsProbe } from './replay';
import { RequestCorrelation,scopeForTab } from '../session/scope';
const scope = {browser:'firefox',profile:crypto.randomUUID(),private:false,cookie_store_id:'firefox-container-1',container_id:'firefox-container-1',partition_key:null,claim_generation:1};
describe('replay and session ownership',()=>{
  it('never infers repeatability from GET or signed-looking URLs',()=>{
    expect(classifyReplay({method:'GET',sourceGeneration:1}).disposition).toBe('unknown');
    expect(classifyReplay({method:'POST',sourceGeneration:1}).disposition).toBe('browser_stream_only');
    expect(classifyReplay({method:'GET',singleUse:true,repeatable:true,sameSession:true,sourceGeneration:1}).disposition).toBe('browser_stream_only');
    const allowed=classifyReplay({method:'GET',repeatable:true,sameSession:true,sourceGeneration:1});
    expect(permitsProbe(allowed,2)).toBe(false);
    expect(permitsProbe(allowed,1)).toBe(true);
  });
  it('correlates identical URLs without mixing stores or accepting ambiguity',()=>{
    const records=new RequestCorrelation();
    const req={requestId:'r1',tabId:1,frameId:0,url:'http://fixture/file',method:'GET',headers:{},time:Date.now(),scope};
    records.observe(req);
    records.observe({...req,requestId:'r2',tabId:2,scope:{...scope,cookie_store_id:'firefox-container-2'}});
    expect(records.unique(req.url,false)).toBeUndefined();
    expect(records.find(req.url,scope,1)?.requestId).toBe('r1');
    expect(records.find(req.url,{...scope,claim_generation:2},1)).toBeUndefined();
    records.removeTab(1);
    expect(records.find(req.url,scope,1)).toBeUndefined();
  });
  it('fails closed instead of using the default cookie store',async()=>{
    await expect(scopeForTab({tabs:{get:async()=>({incognito:true})},cookies:{getAllCookieStores:async()=>[]}},'firefox',scope.profile,1,1)).rejects.toThrow('substitution denied');
  });
});
