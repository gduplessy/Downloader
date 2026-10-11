# FlareSolverr qualification — 2026-10-10/11

## Scope and environment

Implemented on `codex/flaresolverr-integration`, initially based on fetched `origin/feat/transfer-engine-correctness` at `ee1442b`, with the response-validator fixes at `604a7d9` incorporated before delivery. The original checkout and its uncommitted evidence files were preserved. Delivery commits independently increment the product version. The PR targets `feat/transfer-engine-correctness`; this integration is not merged.

Local target: Windows x64, Docker Desktop Linux amd64, Docker client/server **29.6.2**, Compose **5.3.1**, FlareSolverr **3.4.6**, reported Chromium **142**. The existing service on 9191 was reused without modification. The isolated deployment used the repository Compose file with port override 19191 and project `downloader-solver-qualification`.

Qualified image: `flaresolverr/flaresolverr@sha256:7962759d99d7e125e108e0f5e7f3cdbcd36161776d058d1d9b7153b92ef1af9e`. Container inspection confirmed loopback-only port binding, healthy readiness and `unless-stopped`. HTML logging is disabled in Compose. Other architectures/platforms and replacement images are unqualified.

## Results by acceptance stage

| Stage                              | Result                                                                                                                                 | What it establishes                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| API health                         | Existing and isolated root endpoints returned ready/version 3.4.6; desktop/service connection command passed.                          | Reachability and service identity only.                             |
| Browser rendering                  | Chromium executed fixture JavaScript, exposed a GET link and returned the fixture cookie.                                              | Rendered-page resolution; no real Cloudflare challenge was present. |
| Real browser challenge clearance   | Not qualified.                                                                                                                         | No live Cloudflare success claim.                                   |
| Source resolution                  | Service accepted one confident GET source through engine metadata validation.                                                          | A resolvable file candidate, not transfer completion.               |
| Verified transfer                  | Generated **2,097,152 bytes**, pause/resume, four range GETs, matching cookie/User-Agent checks, SHA-256 and final publication passed. | Actual libcurl transfer correctness for the permitted fixture.      |
| Custom CAPTCHA / expiry            | Returned `solver_captcha` / `solver_expired`, zero bytes; no completed file.                                                           | Unsupported pages retain manual recovery.                           |
| Fresh g4u links / downstream hosts | Not qualified.                                                                                                                         | Host selection and custom interaction remain separate gates.        |

Three valid integration runs completed: one against the existing service and two against the isolated image (**3/3 controlled transfer successes**). Each run also correctly refused one CAPTCHA fixture and one expiry fixture (**3/3 zero-byte refusals for each**). These small fixture samples are not estimates of live-site success rates. The generated fixture contains ordinary JavaScript and an application cookie, not Cloudflare protection.

Output SHA-256: `1e075c8d478ad21844e33e830a695ef03a4d2488b69ee275bd8947618bb1be1e`.

Final isolated run, measured end to end through CLI/service:

- Connection test including isolated service startup: **2.054 s**.
- Independent Chromium rendering probe: **6.684 s**.
- Source resolution acknowledgement: **8.400 s**.
- Solve, transfer, pause/resume and verification: **34.804 s**; paused at **272,889 bytes**.
- Custom-CAPTCHA refusal: **6.808 s**; expiry refusal: **8.906 s**.
- Four range requests; nine cookie/User-Agent-validated file requests including metadata; 63.118 s for the full qualification script.

The transfer fixture intentionally limits throughput and delays chunks to make pause/resume observable. Timings include process startup, polling and local machine load; they are not provider SLAs. Earlier script runs waited on inherited Windows daemon pipe handles, inflating startup measurement to 90 s. The final script waits for actual CLI process exit, and its final measurement is the applicable startup result.

Sanitized JSON is in [existing-service evidence](evidence/flaresolverr-2026-10-11/existing-service.json), [isolated deployment evidence](evidence/flaresolverr-2026-10-11/isolated-initial.json) and [final isolated evidence](evidence/flaresolverr-2026-10-11/isolated-final.json). No signed URLs, job/profile identifiers, filesystem paths, HTML, cookies or User-Agent strings are published there.

## Deterministic and regression checks

- Settings default/compatibility and loopback validation; malformed, oversized, HTTP/provider-error and stalled API responses; cancellation and sanitized failures.
- Browser protection versus custom CAPTCHA, login, expiry and countdown; hidden/ambiguous/POST controls; bounded GET links/forms and traversal loops.
- Cookie domain/path/expiry/security and matching User-Agent; separate connection-pool identity; cross-origin redirect header stripping.
- Globally serialized solve jobs, wrong-profile rejection, automatic-attempt limit, cancellation, page changes, settings changes and late-result discard.
- Session destruction on success/failure/cancellation; cleanup failure retained for retry; interrupted solving recovers to manual navigation with no persisted session material.
- Range/cookie propagation, known SHA-256, and rejection of challenge/expiry HTML even when served as binary with no expected checksum.
- Existing transfer/recovery tests retain ordinary resume/checksum, manual ownership, source refresh and browser fallback regressions.

Validation commands and results are recorded in the PR. Live-site and Docker qualification stay outside mandatory CI. Cross-platform/browser tests for these new workflows, visible native settings interaction, installer acceptance and native-language translation review remain pending.

## Custom CAPTCHA findings and limits

Two supplied g4u links reported expiry; the originating page and explicit ddownload host choice were inspected. The 400 × 140 image challenge requires a session-aware coordinate click and warns against competing challenges. The [research report](CAPTCHA_RESEARCH.md) specifies serial host selection, scaling/replacement/CSRF/expiry tests, fresh-link grouping, local candidates and the first paid candidate.

There were **0 actual g4u CAPTCHA submissions**, **0 billable tasks**, **$0 spent**, and no challenge/session data sent to a paid provider. Actual local/paid solving success, latency, price and fresh-link compatibility remain unmeasured. No paid adapter, external-solving toggle or credential is shipped; those require separate opt-in, OS-keyring storage and a configured spending ceiling in a subsequent increment.

FlareSolverr is used only for anonymous GET workflows with explicitly Direct routing. Private/credential-backed navigation, login, custom CAPTCHA, countdowns, ambiguous controls, non-replayable POST/blob downloads and routing mismatches remain in the browser. The local container cannot prove shared browser/engine egress IPs or inherit OS/PAC proxy configuration. New service context is required after interruption; service-side browser cookies disappear through owned cleanup, while Downloader never persists them.
