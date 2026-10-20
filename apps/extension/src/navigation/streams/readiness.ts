import type { SessionScope } from '../../../../../packages/shared/src/navigation';

export type CaptureReason =
  'ready' | 'disabled' | 'api_unavailable' | 'permission_required' | 'scope_unavailable';
export interface CaptureLane {
  supported: boolean;
  enabled: boolean;
  ready: boolean;
  reason: CaptureReason;
}
export interface CaptureEnvironment {
  browser: 'chromium' | 'firefox';
  enabled: boolean;
  blobApi: boolean;
  responseApi: boolean;
  scopeApi: boolean;
  blobPermission: boolean;
  responsePermission: boolean;
  scope?: SessionScope;
}
export function captureReadiness(environment: CaptureEnvironment) {
  const e = environment;
  const scopeAvailable =
    e.scopeApi &&
    (!e.scope ||
      (e.scope.browser === e.browser &&
        Boolean(e.scope.profile && e.scope.cookie_store_id) &&
        Number.isSafeInteger(e.scope.claim_generation) &&
        e.scope.claim_generation > 0));
  const lane = (api: boolean, permission: boolean): CaptureLane => {
    const reason: CaptureReason = !api
      ? 'api_unavailable'
      : !scopeAvailable
        ? 'scope_unavailable'
        : !permission
          ? 'permission_required'
          : !e.enabled
            ? 'disabled'
            : 'ready';
    return {
      supported: api && scopeAvailable,
      enabled: e.enabled,
      ready: reason === 'ready',
      reason,
    };
  };
  return {
    browser: e.browser,
    blob: lane(e.blobApi, e.blobPermission),
    originalResponse: lane(e.responseApi, e.responsePermission),
  };
}
