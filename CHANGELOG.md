# Changelog

Product versions follow [0.MINOR.PATCH](CONTRIBUTING.md#versioning). Major stays at 0 until the IDM parity release gate is satisfied.

## 0.5.4 — Integrate real-realm and filesystem acceptance

- Preserve the merged FlareSolverr functionality and combine the qualification branch without regressing product versions.
- Add real Docker AD NTLM/Kerberos job acceptance, repair the Windows filesystem fixture and publish sanitized PAC/filesystem/realm records.
- Close ENG-06 for the documented filesystem image matrix; retain native SSO, managed proxy policy, installer and IDM comparison gates.

## 0.5.3 — Align solver resolution with the latest transfer base

- Incorporate ordered PAC route/failover and disposable-filesystem fixtures from the updated transfer-engine branch without changing the solver's Direct-only boundary.
- Preserve scoped solver cookies, matching User-Agent and session isolation through the route-aware engine configuration.
- Confirm session absence after a provider restart so an already-removed session cannot leave cleanup blocked; retain failures when the owned session still exists.

## 0.5.2 — Preserve final transfer-engine fixes

- Incorporate the final transfer-engine branch tip, including weak-ETag/Last-Modified validation and published platform evidence, into the solver integration.
- Keep solver qualification separate from the existing platform acceptance results.

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

## 0.3.0 — Local challenge adapter foundation (solver branch)

- Add a bounded loopback FlareSolverr client, conservative GET page resolution, temporary cookie/User-Agent context, and deterministic response/policy regressions.
- Browser navigation integration and live host qualification remain in progress.

## 0.3.4 — Published qualification records (qualification branch)

- Publish sanitized three-platform PAC/network and NTFS/HFS+/ext4 filesystem results with their exact source revisions and CI runs.
- Publish the successful real-realm CI job and local Windows/Linux authentication records, distinguishing native clients, Docker clients and overlapping scenarios.
- Synchronize README, roadmap and acceptance links; keep native SSO, managed proxy policies, installer provenance and the IDM comparison pending.

## 0.3.3 — Real AD authentication acceptance (qualification branch)

- Add a disposable Samba AD realm, Kerberos-only Apache service and domain-backed NTLM endpoint; exercise real authenticated jobs with a volatile fixture credential adapter.
- Pass nine Linux NTLM/Kerberos checks and four native Windows NTLM checks, including wrong-password/missing-ticket recovery without published output.
- Add opt-in realm CI, bounded compiler concurrency, generated-secret cleanup and reusable setup instructions.
- Record passing three-platform PAC and filesystem acceptance; close ENG-06 for the documented NTFS/HFS+/ext4 image matrix. Native SSO/enterprise policy and installer provenance remain explicit.
- Report the local-only omission of the CI hostname/direct-fallback case and reject invalid fixture selectors.

## 0.3.2 — Windows fixture stack repair (qualification branch)

- Move the filesystem filler buffer to the heap after real Windows CI exposed its default-stack overflow.
- Record successful Linux/macOS disk-full, permission, collision and cross-volume recovery acceptance; Windows remains pending until the repaired fixture passes.

## 0.3.1 — Disposable filesystem qualification

- Add bounded 128 MiB image fixtures for actual disk-full, readonly-file refusal, cross-volume publication, collisions and recovery after service restart.
- Refuse to fill the workspace device or format an existing/system disk; qualification detaches only its own image.
- Add an opt-in platform CI acceptance run. Actual platform results remain pending until that run succeeds.

## 0.3.0 — Ordered proxy failover (transfer-engine branch)

- Preserve bounded, ordered PAC/system route lists across Windows, macOS and Linux, including explicit direct fallback.
- Advance metadata, range reads and download workers only after pre-response connection failures; keep TLS, authentication, source and partial-body failures on their original recovery path.
- Isolate pooled handles by their selected route and use cancellable Windows PAC discovery. Explicit PAC refuses WinHTTP's implicit loopback bypass rather than silently selecting direct access.
- Verify actual proxy traversal with named loopback fixtures, exhausted-route failures, TLS/authentication rejection and route-order regressions. Disposable CI runners receive a fixture-only hostname; developer host settings stay untouched.

## 0.2.7 — Clarify remaining proxy work

- Distinguish planned ordered PAC proxy failover from implemented routing whose enterprise policies still require qualification.
- Keep README, roadmap and implementation/evidence documentation aligned with that support boundary.

## 0.2.6 — Acceptance records and synchronized documentation

- Publish post-repair platform transfer, large-file and real native-messaging/CLI evidence with exact source versions and CI runs.
- Complete the deterministic control-protocol roadmap gate; retain external realms, enterprise proxy policies, native filesystem matrices and the unsuccessful IDM comparison as open qualification work.
- Align README, roadmap, compatibility, implementation plan and acceptance records with the verified increment and product version.

## 0.2.5 — Validate Last-Modified alongside weak ETags

- Use Last-Modified when an ETag is weak, including actual range responses and redirect identity checks.
- Reject a changed response date before writing its body even when the weak ETag stays unchanged; retain the explicit safe-restart workflow.

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
