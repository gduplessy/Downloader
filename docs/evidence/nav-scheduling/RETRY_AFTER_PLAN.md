# Retry-After ingestion implementation and remaining qualification

The 0.26.0 implementation connects the production parser to exact main-frame 429/503 request/header observations and consumes a bounded candidate only after live isolated-world document and native scope/source validation. Server waits resist shorter DOM countdowns and block both resolver action stages. Installed qualification is pending. Initial responses before destination session claiming remain separately pending; ownership is never guessed from a URL. Core file-transfer retry handling is a separate path.

## Proposed integration

- Extend the existing `observers()` response-header listener in `apps/extension/src/background.ts` (beside the media content-type observer). Accept bounded Retry-After only from an observed navigation response for an actual task-owned top-level tab. Start with 429/503 responses; qualify other provider statuses individually.
- Bind the response to the exact browser request ID, tab ID, top-level frame and committed document, observed scope, claim generation and source generation. The existing asynchronous request observer is not a safe URL-only lookup: register an ephemeral promise/key synchronously on request observation and resolve the exact identity before consuming headers. Buffer a new-document header only until committed-document/owning-tab authority can be verified; reject replaced or foreign responses.
- Revalidate `ownsCurrentTab`, exact current native job scope/source and document binding immediately before recording a server wait. Use the existing bounded `retryAfter()` parser. Persist only numeric duration/deadline/generation and a fixed or opaque hashed reason; never headers, URL tokens or response body.
- Record `basis: server` and `requires_live_tab: true`, with a stable observed deadline that repeated events do not extend. Keep the server deadline independent of a shorter DOM countdown. The resolver action/authorization paths must refuse a commit before the server deadline; current `observeWait()` would otherwise replace a server wait with a fresh page countdown.
- Alarm expiry permits a fresh readiness observation in the same owning document/session. It does not replay a POST, probe a one-use payload or declare readiness from elapsed time. A provider-specific page/status observation must still establish the control is usable. Cancellation and document/source/claim changes clear the observation through their existing authority fences.

## Required evidence

- Actual installed extension/native response-header ingestion on a loopback page with 429/503, numeric and HTTP-date headers, malformed/oversized values, repeated responses, and an independently enforced server deadline longer than the visible DOM timer.
- Count original submissions; require zero early/duplicate POSTs and zero automatic payload refetch. Alarm/worker recovery must preserve the original server deadline and revalidate readiness.
- Reject stale request IDs, replaced documents, redirects into a different scope, private/regular mixing and same-site competing tabs. Confirm invalidation/cancellation removes the wait and alarm without touching a retained user-origin tab.

The design and remaining evidence requirements above remain the acceptance contract. No installed Retry-After browser-navigation acceptance is claimed by implementation or unit tests alone.
