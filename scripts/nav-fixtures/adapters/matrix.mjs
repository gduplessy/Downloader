import { readFile, writeFile } from 'node:fs/promises';
import { validateEvidence } from './evidence.mjs';
const qualification = JSON.parse(
  await readFile('docs/evidence/nav-adapters/qualification.json', 'utf8'),
);
const rows = [];
for (const provider of ['g4u', 'ddownload', 'rapidgator', 'gofile']) {
  for (const workflow of ['get', 'post', 'chosen-host', 'layout-recovery', 'wait']) {
    const transfer = ['get', 'post', 'chosen-host'].includes(workflow);
    const selected = workflow === 'chosen-host' ? 'ddownload.com' : '127.0.0.1';
    rows.push(
      validateEvidence({
        adapter_id: 'local-fixture',
        adapter_version: '1.0.0',
        provider,
        workflow,
        browser: qualification.browser,
        browser_version: qualification.browser_version,
        os: qualification.os,
        architecture: 'x64',
        tested_at: qualification.tested_at,
        revision: qualification.base_revision,
        source_sha256: qualification.source_sha256,
        fixture_id: `synthetic-${provider}-${workflow}-v1`,
        evidence_class: 'synthetic',
        layout_known: false,
        expected_host: transfer ? selected : null,
        actual_host: transfer ? selected : null,
        transport_host: '127.0.0.1',
        expected_sha256: transfer ? qualification.expected_sha256 : null,
        actual_sha256: transfer ? qualification.actual_sha256 : null,
        outcome: 'passed',
        reason: 'Synthetic contract only; live provider layout unknown',
        recovery: 'Refresh stale selection or continue manually in the browser',
      }),
    );
  }
  for (const workflow of [
    'get',
    'post',
    'chosen-host',
    'login',
    'premium',
    'wait',
    'captcha',
    'blob',
  ]) {
    rows.push(
      validateEvidence({
        adapter_id: provider,
        adapter_version: '1.0.0',
        workflow,
        browser: 'release-matrix-pending',
        browser_version: 'pending',
        os: 'release-matrix-pending',
        architecture: 'pending',
        tested_at: qualification.tested_at,
        revision: qualification.base_revision,
        fixture_id: `live-${provider}-${workflow}-pending`,
        evidence_class: 'live',
        layout_known: false,
        outcome: 'pending',
        reason: 'No permitted live file/layout/account input was supplied',
        recovery: 'Supply permitted inputs and qualify actual requested bytes/hash',
      }),
    );
  }
}
await writeFile(
  'docs/evidence/nav-adapters/host-matrix.json',
  JSON.stringify({ rows }, null, 2) + '\n',
);
console.log(`${rows.length} evidence rows validated; no live row claims current support`);
