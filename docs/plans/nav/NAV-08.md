# NAV-08: direct blob and page-owned streams

## Outcome and baseline

Read a page-owned Blob or response stream inside its actual browser context and send bounded chunks directly to desktop storage. Never send a `blob:` URL to libcurl. Existing behavior leaves blob requests browser-managed; later file import is not accepted as completion.

Owner: batch B. Dependencies: NAV-07 service stream contract and NAV-11 scope; NAV-09 classifies whether another request is safe.

## Implementation increments

1. Establish a supported page/main-world-to-extension bridge for owned tabs and approved capture actions. Determine access to existing blob URLs, download anchors and page fetch/XHR response objects before committing coverage. Document cross-origin frames, opaque responses and worker-created blobs separately.
2. Resolve readable blobs within their owning origin/session while valid, or capture a page-owned readable response before it is consumed. Use a transferable stream/channel where supported, otherwise bounded chunk messages; never buffer/base64 the entire file.
3. Bind source identity, origin/frame, owner generation and an opaque extension-created capability. Reject arbitrary page messages, forged stream IDs, unsolicited byte streams and cross-frame confusion. Page code can mutate data; validate provenance and enforce service-side permissions independently.
4. Use NAV-07 durable chunk/ack handling and final verification/publication. Bound source and native queues; propagate backpressure/cancellation all the way to the reader.
5. Handle blob revocation, tab close, worker/service loss and unknown length with precise recovery. Stop pending readers when ownership changes. Cleanup page hooks and object references after completion or cancellation.
6. Provide explicit direct-capture enablement and destination selection in desktop/extension UI; report unsupported lanes and retain browser completion fallback without counting it as direct streaming.

## Tests and acceptance

- Known Blob, large streamed page response, empty blob, Unicode name, revoked URL, hostile/forged messages, wrong frame/profile, reader failure, cancellation and reconnect.
- Peak buffering is measured and bounded independently of file size; the desktop completes the expected hash with no follow-up HTTP request.
- Complete requires end-of-stream plus verification; interrupted readers retain a typed partial state.
- Qualify actual Chrome/Edge/Firefox stable and ESR lanes. Missing capability is a visible unsupported result, not a successful import.

See [shared execution requirements](README.md).
