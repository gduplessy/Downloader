import { verifyLiveDocument, type DocumentClaim } from '../session/document';
export async function validateAccountDocument(
  api: any,
  browserName: string,
  tabId: number,
  senderDocumentId: string | undefined,
  claim?: DocumentClaim,
): Promise<string> {
  if (browserName === 'firefox' && !claim) throw Error('account_document_stale');
  const tab = await api.tabs.get(tabId);
  if (tab.status !== 'complete' || !tab.url) throw Error('account_document_stale');
  if (claim && !(await verifyLiveDocument(api, browserName, tabId, claim, senderDocumentId)))
    throw Error('account_document_stale');
  if (browserName === 'chromium') {
    const results = await api.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => location.href,
    });
    if (
      results.length !== 1 ||
      results[0].frameId !== 0 ||
      results[0].result !== tab.url ||
      (!claim && !senderDocumentId) ||
      (senderDocumentId !== undefined && results[0].documentId !== senderDocumentId)
    )
      throw Error('account_document_stale');
  }
  return tab.url;
}
