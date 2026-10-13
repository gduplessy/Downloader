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

### Original attachment probe

With `NAV_PAYLOAD=binary`, `NAV_ATTACHMENT=1` and `NAV_NORMALIZE=1`, the server returns the original `application/octet-stream` attachment headers. A probe-only blocking onHeadersReceived listener records those headers, then returns browser-processing headers with Content-Disposition removed, Content-Type set to text/plain and X-Content-Type-Options set to nosniff. This still returns Invalid request ID, zero filtered bytes and one original POST on Firefox 157.0.1. Both header sets are preserved in the matrix; returning modified headers does not itself prove the browser's classification state changed.

This additional packaged probe has no native admission step and does not qualify a production fix. Server-supplied nosniff success cannot be extrapolated to extension-side normalization. Production headers/actions remain unchanged by these artifacts. The exact attachment-to-native path and the internal classification/refusal branch remain pending.

## Installed Firefox Blob lane

[Actual installed Blob evidence](production-firefox-blob.json): stable Firefox 157.0.1 on Windows x64, checked source 12687b4 and native 0.13.5 complete the production worker/resolver/owned_blob_stream path. The original page generates 262,161 deterministic Blob bytes; real keyboard input selects its closed-shadow preview. Native verified SHA-256 and the independently read desktop file both match `ea7079c478bfa028ecbe546e3f39bbf22aa9e5a5d575fd3854105c3c05d6a862`.

Only the original page GET and favicon request reach the local HTTP server. Payload refetches and driver byte relays are zero. The report includes exact service/CLI, source and extension-bundle hashes; source tracing is off. This supports the Blob lane while ordinary binary navigation POST/download filtering remains pending.

Run `NAV_SCENARIO=blob node scripts/nav-fixtures/streams/production-firefox.mjs` from the intended production checkout after building matching CLI/service binaries. `NAV_FILENAME` optionally sets a Unicode destination. The runner creates isolated state, native registration, profile, ports and output and cleans up only its own process tree. Native diagnostics supply the actual binary version.

Live hosts/accounts, Firefox ESR, other OS/browser versions, private/container scope, Blob cancellation/worker-loss and user permission prompts remain separate pending gates. Local permissions are pregranted in the isolated fixture manifest.