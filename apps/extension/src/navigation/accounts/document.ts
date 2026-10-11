export async function validateAccountDocument(
  api: any,
  browserName: string,
  tabId: number,
  senderDocumentId: string | undefined,
): Promise<string> {
  const tab = await api.tabs.get(tabId);
  if (tab.status !== 'complete' || !tab.url) throw Error('account_document_stale');
  if (browserName === 'chromium') {
    const results = await api.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => location.href,
    });
    if (
      results.length !== 1 ||
      results[0].frameId !== 0 ||
      results[0].result !== tab.url ||
      !senderDocumentId ||
      results[0].documentId !== senderDocumentId
    )
      throw Error('account_document_stale');
  }
  return tab.url;
}
