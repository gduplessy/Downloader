import type { Selection } from './types';
import { accountDecision } from './policy';
// Separate purpose from credential-fill grants and generic capture capabilities.
export class PremiumAuthorizations {
  private claims = new Map<
    string,
    { tabId: number; accountId: string; revision: number; expires: number }
  >();
  constructor(private now = Date.now) {}
  issue(token: string, tabId: number, selection: Selection) {
    for (const [key, value] of this.claims)
      if (value.expires <= this.now()) this.claims.delete(key);
    if (!accountDecision(selection, this.now()).premium || this.claims.size >= 128)
      throw Error('account_premium_unavailable');
    this.claims.set(token, {
      tabId,
      accountId: selection.account.id,
      revision: selection.account.revision,
      expires: this.now() + 15000,
    });
  }
  consume(token: string, tabId: number, current: Selection | null) {
    const claim = this.claims.get(token);
    this.claims.delete(token);
    if (!claim) return false;
    if (
      claim.tabId !== tabId ||
      claim.expires <= this.now() ||
      !current ||
      current.account.id !== claim.accountId ||
      current.account.revision !== claim.revision ||
      !accountDecision(current, this.now()).premium
    )
      throw Error('account_premium_stale');
    return true;
  }
  has(token: string) {
    return this.claims.has(token);
  }
  cancel(token: string) {
    this.claims.delete(token);
  }
  invalidateTab(tabId: number) {
    for (const [token, claim] of this.claims) if (claim.tabId === tabId) this.claims.delete(token);
  }
}
