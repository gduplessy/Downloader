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

Set explicit `NAV_NATIVE_BINARY` and `NAV_CLI_BINARY` to canonical checked executable paths, then run `NAV_SCENARIO=blob node scripts/nav-fixtures/streams/production-firefox.mjs` from the intended production checkout. The runner refuses implicit target/debug paths and checks selected native-host/daemon diagnostics before actions. `NAV_FILENAME` optionally sets a Unicode destination. The runner creates isolated state, native registration, profile, ports and output and cleans up only its own process tree. Native diagnostics supply the actual binary version.

Live hosts/accounts, Firefox ESR, other OS/browser versions, private/container scope, Blob cancellation/worker-loss and user permission prompts remain separate pending gates. Local permissions are pregranted in the isolated fixture manifest.

## Installed Firefox page-owned XHR diagnostics

[Controlled native diagnostics](production-firefox-xhr-diagnostic.json) requested immutable extension source 9fa692a (0.13.6), but compiled the unchanged E source base 26ce2a5 (0.10.9) because esbuild cached its initial working directory. Copied checked native binaries came from c310942 (0.14.1). These source-mismatch rows do not qualify the requested checkout. Trusted-options native diagnostics and CLI daemon diagnostics independently report 0.14.1/protocol 1. Exact executable SHA values preserve build provenance.

The original fixture page owns a submit handler that issues one POST to its original form action/body; the extension selects the original control. This distinct fetch/XMLHttpRequest lane does not rewrite an ordinary navigation POST. The final fixture drains/discards response chunks through its own bounded getReader loop. No response bytes reach the driver.

Unread-response and consumed-response controls both leave all 262,161 bytes as unpublished native partials. The traced bounded-consumer row records onstop/finishedtransferringdata before the final durable chunk ACK. The subsequent unconditional filter.resume prevents queued native completion. These are diagnostic rows, not native-transfer acceptance; the production fix and a trace-off native/external SHA run remain required. The 45s traced row ran during other native builds, so elapsed time alone does not establish failure.

Earlier native RPC rejection came from a hardcoded legacy target/debug service (SHA 0ed6cc85...00ba1, Oct10 modification time), whose decoder lacks browser_subscribe. This diagnosis does not change the prior checked Blob pass, which captured a different exact executable SHA.

For an immutable exported source tree, set NAV_SOURCE_ROOT/NAV_SOURCE_REVISION and NAV_NODE_MODULES explicitly. NAV_NATIVE_REVISION records the verified native build revision. Optional NAV_TRACE, NAV_RPC_TRACE and NAV_NATIVE_STDERR flags are metadata-only diagnostics; acceptance requires tracing and the stderr wrapper disabled. The diagnostic wrapper inherits stdin/stdout unchanged and records only its own child stderr/exit. NAV_DIRECT_SUBSCRIBE_PROBE requires zero live resolver/discovery records and uses the actual local owner; it performs no page action.

### Compilation provenance correction

The later requested 11ca/native 0.16 rows also compiled the old E worker. They remain diagnostic failures with exact actual native hashes, not proof that the checked EOF fix failed. The runner now sets explicit absWorkingDir, absolute entry points and onLoad resolveDir. Its metafile asserts every production source module resides in the intended tree; only declared node_modules dependencies may be external. It also verifies the intended capture module is an input and that the checked inputEnded guard appears in the emitted worker. NAV_BUILD_ONLY verifies these controls without launching a browser/native service. The earlier 12687 Blob proof used its intended primary working directory and is unaffected.

## Installed Firefox page-owned XHR acceptance

[Verified direct-stream evidence](production-firefox-xhr.json): Firefox 157.0.1 on Windows x64 completes the original page-owned fetch POST through the production worker, resolver, response filter and persistent native port. Extension and native both use checked source 52b037b, version 0.16.1. Metafile inputs prove production modules come from the intended immutable source tree; explicit entry points and the emitted EOF guard are checked before launch. Native-host/daemon diagnostics and exact executable hashes agree.

The original page issues exactly one POST with its original form action/body and drains its own response using a bounded reader. The server observes one original page GET, favicon GET and one payload POST. No payload refetch, ordinary-form rewrite, browser-file import or driver byte relay occurs. Native verification and the independently read published desktop file both match SHA-256 `ea7079c478bfa028ecbe546e3f39bbf22aa9e5a5d575fd3854105c3c05d6a862` for 262,161 bytes. The job completes with claim generation 1 and source generation 1; tracing and the stderr wrapper are disabled.

This qualifies the distinct page-owned fetch/XMLHttpRequest lane. It does not qualify the pending Firefox binary main-frame form-navigation/download lane. Live hosts/accounts, private/container scope, ESR, other operating systems, user permission prompts and XHR cancellation/worker-loss remain separate pending rows. The source-mismatch diagnostics above remain preserved; they are not acceptance for their requested revisions.

Reproduce with `NAV_SCENARIO=xhr`, explicit checked `NAV_NATIVE_BINARY`/`NAV_CLI_BINARY`, `NAV_TRACE=0`, `NAV_RPC_TRACE=0`, `NAV_NATIVE_STDERR=0` and `NAV_DEADLINE_MS=120000`. To build an immutable export, also provide `NAV_SOURCE_ROOT`, its exact `NAV_SOURCE_REVISION`, `NAV_NATIVE_REVISION` and declared `NAV_NODE_MODULES`. Set `NAV_BUILD_ONLY=0` for actual installed acceptance.
