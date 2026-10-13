import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { scopeForTab } from './scope';

export type TransferPreview = {
  id: string;
  filename: string;
  page_url: string;
  private: boolean;
  expires_at_ms: number;
  source_generation: number;
  claim_generation: number;
};
type Accepted = { id: string; scope: SessionScope; source_generation: number };
type Pending = { token: string; tabId: number; scope: SessionScope; preview: TransferPreview };
function sameRecipient(a: SessionScope, b: SessionScope) {
  return (
    a.browser === b.browser &&
    a.profile === b.profile &&
    a.private === b.private &&
    a.cookie_store_id === b.cookie_store_id &&
    a.container_id === b.container_id
  );
}
/** Tickets remain worker memory only; actual tab APIs supply every session dimension. */
export class NavigationTransfer {
  private pending = new Map<string, Pending>();
  constructor(
    private api: any,
    private browserName: string,
    private profile: Promise<string>,
    private privateLane: boolean,
    private native: (args: unknown) => Promise<any>,
    private permissions: (url: string) => Promise<boolean>,
    private adopted: (accepted: Accepted, tabId: number, page: string) => Promise<void>,
  ) {}
  private async observed(tabId: number) {
    if (!Number.isInteger(tabId) || tabId < 0) throw Error('Select an actual browser tab');
    const tab = await this.api.tabs.get(tabId);
    if (!/^https?:\/\//.test(tab.url ?? '') || Boolean(tab.incognito) !== this.privateLane)
      throw Error('Select an HTTP tab in this browser session');
    const scope = await scopeForTab(this.api, this.browserName, await this.profile, tabId, 1);
    if (scope.private !== this.privateLane) throw Error('Browser session changed');
    return { tab, scope };
  }
  async preview(token: unknown, tabId: number) {
    if (typeof token !== 'string' || token.length > 256 || token.length < 32)
      throw Error('Invalid transfer code');
    const { scope } = await this.observed(tabId);
    const preview: TransferPreview = await this.native({
      action: 'preview',
      token,
      recipient_scope: scope,
    });
    if (
      preview.private !== this.privateLane ||
      !/^https?:\/\//.test(preview.page_url) ||
      !Number.isSafeInteger(preview.expires_at_ms) ||
      preview.expires_at_ms <= Date.now()
    )
      throw Error('Transfer preview is unavailable');
    for (const [id, entry] of this.pending)
      if (entry.preview.expires_at_ms <= Date.now()) this.pending.delete(id);
    if (this.pending.size >= 128) throw Error('Too many pending transfers');
    const id = crypto.randomUUID();
    this.pending.set(id, { token, tabId, scope, preview });
    setTimeout(() => this.pending.delete(id), Math.max(0, preview.expires_at_ms - Date.now()));
    return { ...preview, preview_id: id };
  }
  discard(id: string) {
    this.pending.delete(id);
  }
  async accept(id: string, consent: boolean) {
    const entry = this.pending.get(id);
    if (!entry || consent !== true || entry.preview.expires_at_ms <= Date.now())
      throw Error('Preview the transfer and explicitly accept it');
    const { tab, scope } = await this.observed(entry.tabId);
    if (!sameRecipient(scope, entry.scope)) throw Error('Recipient session changed');
    if (!(await this.permissions(entry.preview.page_url))) throw Error('Site permission required');
    // Consume the worker preview before asynchronous navigation; duplicate clicks cannot replay.
    this.pending.delete(id);
    const created = await this.api.tabs.create({
      url: entry.preview.page_url,
      active: true,
      windowId: tab.windowId,
      ...(this.browserName === 'firefox' ? { cookieStoreId: scope.cookie_store_id } : {}),
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await this.api.tabs.get(created.id)).status === 'complete') break;
      if (attempt === 199) throw Error('Transfer page did not settle');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const actual = await this.observed(created.id);
    if (!sameRecipient(actual.scope, scope)) throw Error('Transfer tab session changed');
    const accepted: Accepted = await this.native({
      action: 'accept',
      token: entry.token,
      recipient_scope: actual.scope,
      consent: true,
    });
    if (accepted.id !== entry.preview.id || !sameRecipient(accepted.scope, actual.scope))
      throw Error('Invalid accepted transfer session');
    await this.adopted(accepted, created.id, actual.tab.url);
    return { id: accepted.id, tab_id: created.id };
  }
}
