# NAV-07: direct non-replayable POST streaming

## Outcome and baseline

Stream the bytes of the **original POST response** into desktop-managed storage with one submission, preserved session/method/body semantics and no guessed GET. Existing POST fallback finishes in the browser. Browser completion plus later import does not satisfy the owner's requirement.

Owner: batch B, together with NAV-08/09/11. Owner selected one Chromium build declaring required `debugger` permission, with capture disabled by default. It cannot be declared in `optional_permissions`; see [verified API constraints](SOURCES.md).

## Feasibility gate

1. Build a disposable local fixture whose token is consumed on the first POST and whose response is a known large file. Count actual requests and hash delivered bytes.
2. Prove supported Chromium response-stage capture through `debugger`, `Fetch.takeResponseBodyAsStream` and sequential `IO.read` before the final POST is triggered. Scope attachment and interception to explicit owned tabs/actions. Test download/navigation behavior, cancellation, DevTools-triggered detach and enterprise attach refusal on Chrome/Edge stable.
3. Prove Firefox `webRequest.filterResponseData` with `webRequest`, `webRequestBlocking` and target host permissions on stable/ESR. Its stream must be explicitly written/closed/disconnected. Add further permissions only for deliberately supported MV3/service-worker-script cases. Investigate page-owned fetch streaming separately; it does not establish ordinary form/navigation capture.
4. Publish a matrix of form navigation, fetch, XHR, redirects, download responses, service-worker responses and unsupported cases. Do not build a full backend around an API that cannot capture the required lane. Escalate any required unsupported case with a runnable reproducer.

## Implementation increments

- Arm capture only for an explicit owned navigation job, exact target scope and selected action. Check native stream readiness before consuming a one-use submission; ordinary unrelated browsing is unaffected.
- Build owner-bound begin/chunk/ack/end/abort commands over a persistent native messaging port with opaque IDs, sequence/offset checks and payloads below the 1 MiB native frame limit. Start with 192 KiB raw chunks and a bounded acknowledgement window; measure before tuning. Native host/service ownership checks apply to every frame.
- Stream bytes into service-owned partial storage, acknowledging durable writes. Worker memory stays bounded by the negotiated window rather than file size. Use existing verification, quota, scanner and no-overwrite publication infrastructure.
- Model the irreversible capture boundary explicitly: some response APIs cannot continue the original response after its stream is taken. Before takeover keep the browser path viable; afterward retain durable desktop staging and report irrecoverable upstream interruption without replaying the POST.
- Recover bridge reconnect by stream ID/accepted offset when the source reader survives. After browser/process loss, require a fresh user/provider action unless the adapter proves resumability. Never promise generic resume of an already consumed token.
- Add feature opt-in UI, install-time permission explanation, attachment/capture status, cancel, and debugger-detach recovery. Attachment refusal uses browser fallback but remains an unmet direct-stream matrix row.

## Tests and acceptance

- Exactly one original POST, expected body/session, correct redirects, matching complete hash, and no duplicate engine inspect/HEAD/GET of the response URL.
- Empty/unknown-length/large responses; throttled native writer; malformed/out-of-order/duplicate chunks; disk full, quota, cancellation, disconnect and browser restart.
- No partial job becomes Complete. No token/body/cookie appears in settings, events, diagnostics or evidence.
- Stable-browser direct-stream proof is required for each supported lane. Mocks and successful browser fallback do not close NAV-07.

See [shared contracts and PR requirements](README.md).
