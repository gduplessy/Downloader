import type { SessionScope } from '../../../../packages/shared/src/navigation';

export type NavigationAuthorizationBinding = {
  tabId: number;
  frameId: number;
  documentId?: string;
  page: string;
  scope: SessionScope;
  sourceGeneration: number;
  documentGeneration: number;
  adapterId: string;
  adapterVersion: string;
  fingerprint: string;
};
export type NavigationAction = { url: string; method: string; selectedHost?: string | null };
type Grant = { binding: string; action: NavigationAction; expires: number };

// Preparing a grant does not attach a debugger, read a blob or submit a request.
// The content script commits it only after fresh inspection and cancellation checks.
export class NavigationAuthorizations {
  private grants = new Map<string, Grant>();
  constructor(
    private now = Date.now,
    private lifetimeMs = 15000,
  ) {}

  issue(binding: NavigationAuthorizationBinding, action: NavigationAction): string {
    this.prune();
    if (this.grants.size >= 128) throw Error('navigation_authorization_capacity');
    const page = new URL(binding.page);
    const destination = new URL(action.url);
    if (
      binding.frameId !== 0 ||
      !Number.isSafeInteger(binding.tabId) ||
      binding.tabId < 0 ||
      !Number.isSafeInteger(binding.sourceGeneration) ||
      binding.sourceGeneration < 1 ||
      !Number.isSafeInteger(binding.documentGeneration) ||
      binding.documentGeneration < 1 ||
      !Number.isSafeInteger(binding.scope.claim_generation) ||
      binding.scope.claim_generation < 1 ||
      !['http:', 'https:'].includes(page.protocol) ||
      page.username ||
      page.password ||
      !['http:', 'https:', 'blob:'].includes(destination.protocol) ||
      destination.username ||
      destination.password ||
      (destination.protocol === 'blob:' && destination.origin !== page.origin) ||
      !['GET', 'POST'].includes(action.method) ||
      !binding.adapterId ||
      !binding.adapterVersion ||
      !/^[a-f0-9]{64}$/.test(binding.fingerprint)
    )
      throw Error('navigation_authorization_invalid');
    const token = crypto.randomUUID();
    this.grants.set(token, {
      binding: this.key(binding),
      action: {
        url: destination.href,
        method: action.method,
        ...(action.selectedHost !== undefined ? { selectedHost: action.selectedHost } : {}),
      },
      expires: this.now() + this.lifetimeMs,
    });
    return token;
  }

  consume(token: string, current: NavigationAuthorizationBinding): NavigationAction {
    const grant = this.grants.get(token);
    // Consume before any asynchronous side effect, including failed validation.
    this.grants.delete(token);
    if (!grant || grant.expires <= this.now() || grant.binding !== this.key(current))
      throw Error('navigation_authorization_stale');
    return { ...grant.action };
  }

  cancel(token: string): void {
    this.grants.delete(token);
  }
  invalidateTab(tabId: number): void {
    for (const [token, grant] of this.grants)
      if ((JSON.parse(grant.binding) as NavigationAuthorizationBinding).tabId === tabId)
        this.grants.delete(token);
  }
  private key(binding: NavigationAuthorizationBinding): string {
    // Explicit field order prevents caller object-key order from affecting identity.
    return JSON.stringify({
      tabId: binding.tabId,
      frameId: binding.frameId,
      documentId: binding.documentId ?? null,
      page: binding.page,
      scope: {
        browser: binding.scope.browser,
        profile: binding.scope.profile,
        private: binding.scope.private,
        cookie_store_id: binding.scope.cookie_store_id,
        container_id: binding.scope.container_id,
        partition_key: binding.scope.partition_key,
        claim_generation: binding.scope.claim_generation,
      },
      sourceGeneration: binding.sourceGeneration,
      documentGeneration: binding.documentGeneration,
      adapterId: binding.adapterId,
      adapterVersion: binding.adapterVersion,
      fingerprint: binding.fingerprint,
    });
  }
  private prune(): void {
    for (const [token, grant] of this.grants)
      if (grant.expires <= this.now()) this.grants.delete(token);
  }
}
