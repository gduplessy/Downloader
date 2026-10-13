import { scopeKey } from '../adapters/context';
import type { AccountBinding } from './types';
export function sameAccountBinding(a: AccountBinding, b: AccountBinding): boolean {
  return (
    a.tabId === b.tabId &&
    a.frameId === b.frameId &&
    scopeKey(a.scope) === scopeKey(b.scope) &&
    a.scope.claim_generation === b.scope.claim_generation &&
    a.sourceGeneration === b.sourceGeneration &&
    a.documentGeneration === b.documentGeneration &&
    a.documentNonce === b.documentNonce &&
    a.documentId === b.documentId &&
    a.page === b.page &&
    a.adapterId === b.adapterId &&
    a.adapterVersion === b.adapterVersion
  );
}
