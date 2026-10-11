import assert from 'node:assert/strict';
import { validateEvidence } from './evidence.mjs';
const row = {
  adapter_id: 'local-fixture',
  adapter_version: '1.0.0',
  workflow: 'get',
  browser: 'Chromium',
  browser_version: 'fixture',
  os: 'Windows 11',
  architecture: 'x64',
  tested_at: '2026-10-11T04:00:00Z',
  revision: '2a3ac06',
  fixture_id: 'http-v1',
  evidence_class: 'synthetic',
  layout_known: false,
  expected_host: 'ddownload.com',
  actual_host: 'ddownload.com',
  expected_sha256: 'a'.repeat(64),
  actual_sha256: 'a'.repeat(64),
  outcome: 'passed',
  reason: 'local fixture',
  recovery: 'reinspect',
};
const now = new Date('2026-10-11T06:00:00Z');
assert.equal(validateEvidence(row, now).current_support, false);
assert.throws(
  () => validateEvidence({ ...row, actual_sha256: 'b'.repeat(64) }, now),
  /matching hash/,
);
assert.throws(
  () => validateEvidence({ ...row, actual_host: 'https://ddownload.com/signed?secret=x' }, now),
  /public hostname/,
);
assert.throws(() => validateEvidence({ ...row, evidence_class: 'live' }, now), /Unobserved layout/);
assert.equal(
  validateEvidence({ ...row, evidence_class: 'live', layout_known: true }, now).current_support,
  true,
);
assert.equal(
  validateEvidence(
    { ...row, evidence_class: 'live', layout_known: true, tested_at: '2026-09-01T00:00:00Z' },
    now,
  ).expired,
  true,
);
console.log('Evidence schema: 6 checks passed');
