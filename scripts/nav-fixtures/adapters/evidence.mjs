export const evidenceKinds = ['synthetic', 'recorded-layout', 'live'];
export const workflows = [
  'get',
  'post',
  'chosen-host',
  'layout-recovery',
  'login',
  'premium',
  'wait',
  'captcha',
  'blob',
];
export function validateEvidence(row, now = new Date()) {
  for (const key of [
    'adapter_id',
    'adapter_version',
    'workflow',
    'browser',
    'browser_version',
    'os',
    'architecture',
    'tested_at',
    'revision',
    'fixture_id',
    'evidence_class',
    'outcome',
    'reason',
    'recovery',
  ]) {
    if (typeof row[key] !== 'string' || !row[key].trim()) throw Error(`Missing ${key}`);
  }
  if (!evidenceKinds.includes(row.evidence_class) || !workflows.includes(row.workflow))
    throw Error('Invalid evidence class or workflow');
  if (!['passed', 'pending', 'failed', 'manual'].includes(row.outcome))
    throw Error('Invalid evidence outcome');
  if (typeof row.layout_known !== 'boolean') throw Error('Missing layout-known classification');
  if (!/^\d+\.\d+\.\d+$/.test(row.adapter_version) || !/^[a-f0-9]{7,40}$/.test(row.revision))
    throw Error('Invalid adapter version or revision');
  const tested = new Date(row.tested_at);
  if (!Number.isFinite(tested.getTime()) || tested > now) throw Error('Invalid evidence date');
  for (const key of ['expected_host', 'actual_host']) {
    if (row[key] != null && (typeof row[key] !== 'string' || !/^[a-z0-9.-]+$/.test(row[key])))
      throw Error('Host must be a public hostname, not a URL');
  }
  if (row.outcome === 'passed' && ['get', 'post', 'chosen-host', 'blob'].includes(row.workflow)) {
    if (
      !/^[a-f0-9]{64}$/.test(row.expected_sha256) ||
      row.actual_sha256 !== row.expected_sha256 ||
      row.actual_host !== row.expected_host
    )
      throw Error('Passing transfers require matching hash and selected-host provenance');
  }
  if (row.evidence_class !== 'synthetic' && row.outcome === 'passed' && !row.layout_known)
    throw Error('Unobserved layout cannot be qualified');
  const expired =
    row.evidence_class !== 'synthetic' && now.getTime() - tested.getTime() > 30 * 86400000;
  return {
    ...row,
    current_support: row.evidence_class === 'live' && row.outcome === 'passed' && !expired,
    expired,
  };
}
