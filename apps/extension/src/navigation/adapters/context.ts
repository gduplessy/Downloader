import type { SessionScope } from '../../../../../packages/shared/src/navigation';
export type ResolverContext = {
  tabId: number;
  frameId: number;
  scope: SessionScope;
  sourceGeneration: number;
  selectedHost?: string;
  disabledAdapters?: string[];
  capabilities?: { pageBlob?: boolean };
  locale: string;
};
export function scopeKey(scope: SessionScope): string {
  const {
    browser,
    profile,
    private: privateSession,
    cookie_store_id,
    container_id,
    partition_key,
  } = scope;
  return JSON.stringify({
    browser,
    profile,
    private: privateSession,
    cookie_store_id,
    container_id,
    partition_key,
  });
}
