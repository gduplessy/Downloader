export type DocumentClaim = { nonce: string; generation: number };
export type LiveDocument = { nonce: string; documentId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Coalesce startup only when the actual isolated world already runs the resolver. */
export async function hasLiveResolver(
  browser: any, kind: string, tabId: number,
  expected: { nonce?: string; documentId?: string },
): Promise<boolean> {
  const marker = () => {
    const root = globalThis as typeof globalThis & {
      __downloaderDocumentNonce?: string; __downloaderResolver?: boolean;
    };
    return root.__downloaderResolver ? root.__downloaderDocumentNonce ?? null : null;
  };
  try {
    const results = kind === 'chromium'
      ? await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: marker })
      : kind === 'firefox'
        ? await browser.tabs.executeScript(tabId, {
          frameId: 0,
          code: 'globalThis.__downloaderResolver ? globalThis.__downloaderDocumentNonce ?? null : null',
        }) : [];
    if (results.length !== 1) return false;
    const nonce = kind === 'chromium' ? results[0].result : results[0];
    return typeof nonce === 'string' && uuid.test(nonce)
      && (!expected.nonce || expected.nonce === nonce)
      && (kind !== 'chromium' || (results[0].frameId === 0
        && (!expected.documentId || expected.documentId === results[0].documentId)));
  } catch { return false; }
}
/** Read only the extension's isolated-world marker from the actual live top document. */
export async function verifyLiveDocument(
  browser: any,
  kind: string,
  tabId: number,
  claim: DocumentClaim,
  senderDocumentId?: string,
): Promise<LiveDocument | null> {
  if (
    !claim ||
    !uuid.test(claim.nonce) ||
    !Number.isSafeInteger(claim.generation) ||
    claim.generation < 1
  )
    return null;
  const marker = () => {
    const root = globalThis as typeof globalThis & { __downloaderDocumentNonce?: string };
    return root.__downloaderDocumentNonce ?? null;
  };
  try {
    if (kind === 'chromium') {
      const result = await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: marker,
      });
      if (
        result.length !== 1 ||
        result[0].frameId !== 0 ||
        result[0].result !== claim.nonce ||
        (senderDocumentId && result[0].documentId && senderDocumentId !== result[0].documentId)
      )
        return null;
      return { nonce: claim.nonce, documentId: result[0].documentId };
    }
    if (kind === 'firefox') {
      const result = await browser.tabs.executeScript(tabId, {
        frameId: 0,
        code: 'globalThis.__downloaderDocumentNonce ?? null',
      });
      if (result.length !== 1 || result[0] !== claim.nonce) return null;
      return { nonce: claim.nonce };
    }
  } catch {
    return null;
  }
  return null;
}
