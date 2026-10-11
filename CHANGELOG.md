# Changelog

Product versions follow [0.MINOR.PATCH](CONTRIBUTING.md#versioning). Major stays at 0 until the IDM parity release gate is satisfied.

## 0.5.1 — Qualified Docker setup and challenge limits

- Publish the pinned Compose deployment, Docker walkthrough, measured real-service fixture evidence and g4u/CoordinatesTask research gates.
- Add an opt-in isolated qualification script for rendered GET resolution, cookie/User-Agent propagation, range pause/resume, SHA-256 and zero-byte unsupported-page refusal.
- Verify stalled/cancelled API handling and reject epoch-expired cookies. Live Cloudflare clearance, fresh g4u links and downstream hosts remain unqualified; no paid calls were made.

## 0.5.0 — Solver configuration and recovery

- Add desktop enablement, loopback endpoint and timeout controls, connection testing with service version, and manual desktop/extension solver actions.
- Translate solver states, settings and recovery messages across all six locales.
- Invalidate in-flight results on routing/configuration changes, isolate cross-origin page sessions, and retain failed cleanup identifiers for restart/connection-test cleanup.
- Live custom CAPTCHA and downstream-host compatibility remain qualification limits.

## 0.4.0 — Owned challenge navigation

- Run asynchronous, globally serialized solver jobs through the service; preserve profile ownership, cancellation and restart recovery, and reject stale page results.
- Automatically attempt recognized browser challenges once after opt-in. Keep custom CAPTCHA, authentication, expiry, countdowns and ambiguous controls in browser navigation.
- Preserve temporary cookies and the matching User-Agent in ranged transfers; reject hosted HTML before publication, including pages labeled as binary.
- Desktop controls and live qualification remain in progress.

## 0.3.0 — Local challenge adapter foundation

- Add a bounded loopback FlareSolverr client, conservative GET page resolution, temporary cookie/User-Agent context, and deterministic response/policy regressions.
- Browser navigation integration and live host qualification remain in progress.

## 0.2.4 — Windows system proxy protocol maps

- Parse system proxy protocol labels case-insensitively and trim map entries, so an uppercase HTTPS mapping does not silently select direct routing.
- Verify distinct HTTP/HTTPS mappings and explicit HTTPS proxy URLs without changing intentional direct routing for an unmapped scheme.

## 0.2.3 — Preserve primary transfer failures

- Keep the first worker failure when sibling libcurl requests abort, preserving storage/source recovery actions instead of replacing them with a secondary network error.
- Retain the storage-failure assertions and repeat the real write/flush subprocess fixture; a Windows CI failure exposed the race.

## 0.2.2 — Browser response privacy

- Project native creation, navigation and refresh responses through the same browser-safe field allowlist as snapshots/events.
- Exercise a real native-messaging process in the isolated CLI fixture, including repeated creation, response correlation and absence of desktop paths/credential metadata.

## 0.2.1 — Routing and hostile-response regressions

- Match Windows manual proxy bypass host wildcards and `<local>` consistently, including case-insensitive matching and whole-host boundaries.
- Verify actual malformed range responses fall back without corrupting output, and encoded Unicode server filenames remain portable.
- Keep README, roadmap and package versions synchronized; enterprise proxy policy qualification remains open.

## 0.2.0 — Transfer engine and control contract

- Validate range responses and remote revisions; recover durable checkpoints, interrupted verification, and no-overwrite publication without false completion.
- Reuse isolated libcurl connections with host/global limits and concurrency backoff. Add HTTP/2, FTP/FTPS, routing/authentication/TLS controls and capability diagnostics.
- Add typed failures, browser-owned source refresh, sequenced events, reconnect snapshots, durable request receipts, and CLI progress watching.
- Add protocol/proxy fixtures, ten actual crash boundaries, storage-failure regressions, real CLI/service acceptance, ZIP64 offsets and transfers above 4 GiB.
- Publish reproducible performance measurements and remaining qualification gates. IDM comparison remains pending because the installed executable produced no fixture download.
- Synchronize desktop, CLI, service, extension and documentation versions; check drift in CI. Use pathname permissions for macOS IPC because Darwin does not support socket-descriptor chmod.

## 0.1.0 — Initial development preview

- Original GPL-3.0 desktop, CLI and extension foundation, hosted-page navigation fixtures, media/grabber adapters and public roadmap.
