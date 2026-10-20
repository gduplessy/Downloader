import { describe, expect, it } from 'vitest';
import { captureReadiness, type CaptureEnvironment } from './readiness';
const supported: CaptureEnvironment = {
  browser: 'chromium',
  enabled: false,
  blobApi: true,
  responseApi: true,
  scopeApi: true,
  blobPermission: true,
  responsePermission: true,
};
describe('direct capture readiness', () => {
  it('keeps API support separate from per-profile opt-in', () => {
    expect(captureReadiness(supported).blob).toEqual({
      supported: true,
      enabled: false,
      ready: false,
      reason: 'disabled',
    });
    expect(captureReadiness({ ...supported, enabled: true }).blob.ready).toBe(true);
  });
  it('reports independent Blob and response APIs', () => {
    const result = captureReadiness({ ...supported, enabled: true, responseApi: false });
    expect(result.blob.ready).toBe(true);
    expect(result.originalResponse.reason).toBe('api_unavailable');
  });
  it('reports scope and permission blockers before preference', () => {
    expect(captureReadiness({ ...supported, scopeApi: false }).blob.reason).toBe(
      'scope_unavailable',
    );
    expect(captureReadiness({ ...supported, blobPermission: false }).blob.reason).toBe(
      'permission_required',
    );
  });
  it('rejects a scope belonging to another browser or without a claim', () => {
    const scope = {
      browser: 'firefox',
      profile: 'p',
      cookie_store_id: '0',
      private: false,
      container_id: null,
      partition_key: null,
      claim_generation: 1,
    };
    expect(captureReadiness({ ...supported, scope }).blob.reason).toBe('scope_unavailable');
    expect(
      captureReadiness({
        ...supported,
        scope: { ...scope, browser: 'chromium', claim_generation: 0 },
      }).blob.ready,
    ).toBe(false);
  });
});
