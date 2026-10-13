import { showChallenge } from '../../../apps/extension/src/navigation/challenges/page';
import { collectControls } from '../../../apps/extension/src/navigation/adapters/dom';
import { inspectCandidates } from '../../../apps/extension/src/navigation/adapters/policy';
const profile = 'c3b45e0f-227f-41fc-b9c5-af170af9a65d';
async function load(provider: string) {
  const iframe = document.createElement('iframe');
  iframe.width = '900';
  iframe.height = '500';
  iframe.src = '/nav-challenges/' + provider + '/page';
  const ready = new Promise<void>((resolve) => (iframe.onload = () => resolve()));
  document.body.append(iframe);
  await ready;
  return iframe;
}
async function run() {
  const rows: any[] = [];
  for (const provider of ['g4u', 'ddownload', 'rapidgator', 'gofile']) {
    const iframe = await load(provider),
      doc = iframe.contentDocument!;
    const original = doc.createElement.bind(doc);
    let shadow: ShadowRoot | undefined;
    doc.createElement = ((tag: string, options: any) => {
      const element = original(tag, options);
      if (tag === 'div') {
        const attach = element.attachShadow.bind(element);
        element.attachShadow = (init: ShadowRootInit) => {
          const root = attach(init);
          if (init.mode === 'closed') shadow = root;
          return root;
        };
      }
      return element;
    }) as typeof doc.createElement;
    const ctx: any = {
      tabId: 1,
      frameId: 0,
      scope: {
        browser: 'chromium',
        profile,
        private: false,
        cookie_store_id: '0',
        container_id: null,
        partition_key: null,
        claim_generation: 1,
      },
      sourceGeneration: 1,
      documentGeneration: 1,
      documentNonce: profile,
      selectedHost: 'gofile.io',
      locale: 'en',
    };
    let authorized = 0,
      submitted = 0,
      postResponse = '';
    doc.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted++;
      void fetch('/nav-challenges/' + provider + '/submit', {
        method: 'POST',
        body: new URLSearchParams(new FormData(doc.querySelector('form')!) as any),
      })
        .then((r) => r.text())
        .then((html) => {
          postResponse = html;
        });
    });
    const handle = await showChallenge(
      doc,
      {
        context: async () => ctx,
        authorize: async () => {
          authorized++;
          return true;
        },
        paid: async () => {
          throw Error('Zero budget');
        },
      },
      1,
      () => {},
    );
    if (!handle || !shadow) throw Error('Qualified challenge unavailable');
    const local = Array.from(shadow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Solve locally',
    )!;
    local.click();
    const deadline = Date.now() + 5000;
    while (!postResponse && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (!postResponse || authorized !== 1 || submitted !== 1)
      throw Error('Fresh submission missing');
    doc.body.innerHTML = postResponse;
    const collected = collectControls(doc),
      inspection = inspectCandidates(doc.location.href, collected.controls, {
        selectedHost: 'gofile.io',
      });
    const links = collected.controls.filter((c) => c.panelHost === 'gofile.io' && c.href);
    if (!links.length) throw Error('Selected-host links missing');
    const response = await fetch(links[0].href!);
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    rows.push({
      provider,
      authorized,
      submitted,
      selected_host: 'gofile.io',
      link: links[0].href,
      hash,
      inspection: inspection.kind,
    });
    iframe.remove();
  }

  const staleRows: any[] = [];
  for (const scenario of [
    'cancel',
    'csrf',
    'host',
    'form_action',
    'image_replacement',
    'expiry',
    'claim',
    'source',
    'document_nonce',
    'session',
    'occlusion',
  ]) {
    const iframe = await load('g4u'),
      doc = iframe.contentDocument!;
    let shadow: ShadowRoot | undefined;
    const original = doc.createElement.bind(doc);
    doc.createElement = ((tag: string, options: any) => {
      const el = original(tag, options);
      if (tag === 'div') {
        const attach = el.attachShadow.bind(el);
        el.attachShadow = (init) => {
          const root = attach(init);
          if (init.mode === 'closed') shadow = root;
          return root;
        };
      }
      return el;
    }) as typeof doc.createElement;
    let authorizeResolve: (v: boolean) => void = () => {},
      pending = false,
      attempts = 0;
    doc.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      attempts++;
    });
    const ctx: any = {
      tabId: 1,
      frameId: 0,
      scope: {
        browser: 'chromium',
        profile,
        private: false,
        cookie_store_id: '0',
        container_id: null,
        partition_key: null,
        claim_generation: 1,
      },
      sourceGeneration: 1,
      documentGeneration: 1,
      documentNonce: profile,
      selectedHost: 'gofile.io',
      locale: 'en',
    };
    const handle = await showChallenge(
      doc,
      {
        context: async () => ctx,
        authorize: async () =>
          new Promise((resolve) => {
            pending = true;
            authorizeResolve = resolve;
          }),
        paid: async () => {
          throw Error('zero');
        },
      },
      1,
      () => {},
    );
    Array.from(shadow!.querySelectorAll('button'))
      .find((b) => b.textContent === 'Solve locally')!
      .click();
    const deadline = Date.now() + 5000;
    while (!pending && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (!pending) throw Error('Authorization did not begin');
    if (scenario === 'cancel') handle!.close();
    if (scenario === 'csrf')
      doc.querySelector<HTMLInputElement>('input[name=csrf]')!.value = 'changed';
    if (scenario === 'host')
      doc.querySelector<HTMLInputElement>('input[name=selected_host]')!.value = 'ddownload.com';
    if (scenario === 'form_action')
      doc.querySelector<HTMLFormElement>('form')!.action = '/unexpected';
    if (scenario === 'image_replacement') {
      const image = doc.querySelector('img')!;
      image.replaceWith(image.cloneNode(true));
    }
    if (scenario === 'expiry')
      doc.querySelector<HTMLImageElement>('img')!.dataset.expiresAt = String(Date.now() - 1);
    if (scenario === 'claim') ctx.scope = { ...ctx.scope, claim_generation: 2 };
    if (scenario === 'source') ctx.sourceGeneration = 2;
    if (scenario === 'document_nonce') ctx.documentNonce = '019b0c41-8226-477f-8f3f-bc9f8eeb079d';
    if (scenario === 'session') ctx.scope = {...ctx.scope,cookie_store_id:'other-store'};
    if (scenario === 'occlusion') { const mask=doc.createElement('div');mask.style.cssText='position:fixed;inset:0;background:transparent;z-index:2147483646';doc.documentElement.append(mask); }
    authorizeResolve(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempts) throw Error('Stale submission occurred:' + scenario);
    staleRows.push({ scenario, submissions: attempts });
    handle!.close();
    iframe.remove();
  }
  const chooserFrame = await load('g4u'), chooserDoc = chooserFrame.contentDocument!;
  let chooserShadow: ShadowRoot | undefined, finishChoice: (v: boolean)=>void = ()=>{}, choicePending=false, lateObservations=0;
  const chooserCreate=chooserDoc.createElement.bind(chooserDoc);
  chooserDoc.createElement=((tag:string,options:any)=>{const el=chooserCreate(tag,options);if(tag==='div'){const attach=el.attachShadow.bind(el);el.attachShadow=(init)=>{const root=attach(init);if(init.mode==='closed')chooserShadow=root;return root;};}return el;}) as typeof chooserDoc.createElement;
  const choiceContext:any={tabId:1,frameId:0,scope:{browser:'chromium',profile,private:false,cookie_store_id:'0',container_id:null,partition_key:null,claim_generation:1},sourceGeneration:1,documentGeneration:1,documentNonce:profile,selectedHost:null,locale:'en'};
  const choiceHandle=await showChallenge(chooserDoc,{context:async()=>choiceContext,chooseHost:async()=>new Promise(resolve=>{choicePending=true;finishChoice=resolve;}),authorize:async()=>false,paid:async()=>{throw Error('zero');}},1,()=>{lateObservations++;});
  chooserShadow!.querySelector<HTMLButtonElement>('button')!.click();
  if(!choicePending)throw Error('Host choice did not begin');
  choiceHandle!.close(); finishChoice(true); await new Promise(resolve=>setTimeout(resolve,100));
  if(lateObservations||chooserDoc.getElementById('downloader-challenge'))throw Error('Cancelled host choice reopened');
  staleRows.push({scenario:'host_choice_cancel',submissions:0});
  chooserFrame.remove();
  return {
    fixture: 'synthetic-challenge-dom-v1',
    rows,
    cancelled_submissions: 0,
    stale_rows: staleRows,
    browser: navigator.userAgent,
    qualification:
      'DOM production module; mocked worker authorization; fetch bytes are not native desktop acceptance',
  };
}
(globalThis as any).runChallenges = run;
