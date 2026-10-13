# Installed navigation qualification

## Firefox response-filter differential

[Recorded matrix](firefox-filter-feasibility.json): Firefox 157.0.1 on Windows x64 filters a main-frame original POST containing ASCII text (8,388,625 bytes). Changing only its payload to arbitrary binary bytes produces `Invalid request ID`, zero filtered bytes and one original POST. Both packaged cases use identical `text/plain` headers, no Content-Disposition, persistent MV2, blocking onBeforeRequest, a 500 ms response delay and driver detachment before addon-owned submission. Adding only X-Content-Type-Options: nosniff to the refused binary case restores all 8,388,625 filtered bytes with one POST. This controlled header change causally isolates MIME sniffing in this local API fixture; the exact internal C++ refusal branch remains unobserved. Original attachment responses and production native capture remain pending.

Earlier autonomous probes also record binary main-frame refusal with inline filename metadata and page-owned fetch success (8,388,625 bytes). Fetch and navigation remain separate lanes: a fetch conversion does not satisfy original navigation capture. None of these API probes qualifies production native streaming, desktop publication, final file hashes, live hosts/accounts, private/container scope, other Firefox versions or other platforms.

Reproduce one lane at a time from the repository root:

- `node scripts/nav-fixtures/streams/firefox-filter-feasibility.mjs main_frame` (ASCII payload)
- Set `NAV_PAYLOAD=binary`, then run the same main_frame command for the controlled binary comparison. Add `NAV_NOSNIFF=1` for the nosniff-only comparison.
- `node scripts/nav-fixtures/streams/firefox-filter-feasibility.mjs xmlhttprequest` selects the distinct page-owned fetch lane.

The runner uses unique profiles, extension IDs, ports and loopback output under ignored `.fixture-streams`. It starts no native service and declares no native-messaging permission. Only byte counts/events reach the driver; response bytes stay on their original page path. Windows cleanup verifies its own profile/executable and captured PID creation identity before stopping that process tree. Syntax checks and all three packaged main-frame executions passed; the expected binary refusal is saved as feasibility evidence. The earlier fetch row remains explicitly attributed to its autonomous diagnostic probe.

Current source review records installed-module hashes and Mozilla links. Archived gecko-dev listener-specific remoteTab checks do not describe this Firefox build. Current traceable-channel registration can be dropped when its listener cannot attach; the current lookup checks extension-group process and URI access. These source conditions are leads, not a proven diagnosis of the observed binary refusal. No production header normalization or action rewrite is included.
