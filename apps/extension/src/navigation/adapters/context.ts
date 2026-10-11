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
export { sessionKey as scopeKey } from '../session/scope';
