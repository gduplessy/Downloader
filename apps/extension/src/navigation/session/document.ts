export type DocumentClaim = { nonce: string; generation: number };
export type LiveDocument = { nonce: string; documentId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
