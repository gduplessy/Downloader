# NAV implementation acceptance audit

Audit date: 2026-10-13. Checked integration: `b9231c9` (0.18.2). The thirteen plans and six implementation PR batches exist. This audit distinguishes implemented behavior from acceptance still required; it does not close the roadmap.

## Remaining local gates

| Plan | Checked evidence | Remaining available local acceptance |
| --- | --- | --- |
| NAV-01 | Local solver lifecycle and controls fixtures | Installed native/extension enable, save, test, disable and manual retry controls |
| NAV-02 | Windows keyring lifecycle; installed Chrome/Edge saved login hashes | Firefox/container/private account paths; installed controls |
| NAV-03 | Scoped entitlement/quota/expiry contracts; installed Chromium file hashes | Supported Firefox entitled-session and competing-context paths |
| NAV-04 | Production monotonic scheduler fix; clock, wait and restart policy regressions | Installed enforced server readiness, alarm, sleep/restart; Retry-After integration |
| NAV-05 | Adapter DOM, preview, stale selection and keyboard tests; downstream hashes | Installed disabled-adapter fallback and changed-layout refusal |
| NAV-06 | Four-host synthetic matrix, contribution schema and opt-in smoke command | Live acceptance remains deferred as agreed |
| NAV-07 | Installed Chromium original POST; Edge 8 MiB; Firefox page-owned XHR | Full browser-loss recovery and installed permission/debugger refusal; counted response matrix |
| NAV-08 | Installed Chrome/Edge/Firefox Blob hashes; scoped protocol/lifecycle checks | Supported Firefox loss/cancel/revocation; measured peak buffering independent of file size |
| NAV-09 | Replay policy/fencing, original POST and authenticated one-use GET counts | Remaining consume-on-HEAD/GET, rotating/expired/redirect token counters; changed-partial recovery |
| NAV-10 | Fifty-job Engine/renderer fixture, caps, fairness and host leases | Installed worker admission/resource limits, waits and restart |
| NAV-11 | Actual private Chromium hashes/storage audit; native/recipient transfer and desktop UI tests | Cross-profile transfer evidence integration; actual partitions and download-mapping lifecycle |
| NAV-12 | Installed Chrome/Edge authenticated discovery plus full browser/service/worker restart | Installed cancellation/tab-close/auth expiry negatives; supported Firefox/context rows |
| NAV-13 | Qualified narrow geometry corpus, mocked paid provider, Chrome challenge-to-file hashes | Installed Edge/Firefox invalidation/UI and native controls |

The live cross-profile Chrome transfer has passed in the batch worktree; its checked evidence and Edge repeat are being integrated. The Firefox queued-container fixture reproduced default-store substitution before any file publication. Checked af318b9 now passes actual queued-container hashes and lost-source WaitingUser recovery on Firefox158; private permission and native context-menu UI remain pending. Frame access and partition capabilities must be measured against actual APIs, never synthesized.

## Owner-selected pending rows

- Live g4u, ddownload, Rapidgator and Gofile pages/accounts await permitted inputs.
- Paid 2Captcha qualification remains deferred at the selected $0 budget.
- Firefox 157 binary form-navigation/download capture remains explicitly pending. Supported Firefox Blob/XHR and other available local paths remain separate obligations.
- Unavailable Firefox ESR, macOS and Linux targets remain pending with reproduction instructions.
- Provider APIs follow individual provider qualification; no guessed premium bypass is required or implemented.

See each plan and `docs/evidence/nav-*` for precise source, native executable, browser and fixture limitations. Historical mocks, renderer shims and sampled heaps do not become installed browser or bounded-buffer proof.
