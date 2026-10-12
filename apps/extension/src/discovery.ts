import browser from 'webextension-polyfill';
import { extractRendered } from './navigation/discovery/extract';
const root = globalThis as typeof globalThis & { __downloaderDocumentNonce?: string };
const claim = { nonce: (root.__downloaderDocumentNonce ??= crypto.randomUUID()), generation: 1 };
void browser.runtime
  .sendMessage({ type: 'discovery_context', document: claim })
  .then(async (context) => {
    if ((context as { accepted?: boolean } | undefined)?.accepted) {
      const result = await extractRendered(document);
      await browser.runtime.sendMessage({ type: 'discovery_page_result', document: claim, result });
    }
  })
  .catch(() => {});
