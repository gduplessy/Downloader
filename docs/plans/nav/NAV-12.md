# NAV-12: durable browser-rendered discovery

## Outcome and baseline

Explore rendered pages through owned extension tabs, persist a bounded frontier, show progress and resume when the selected browser is available. Current `grabber::run()` sets rendered projects to `waiting_browser` and returns; static exploration is process-local and uses a default request context.

Owner: batch F. Dependencies: NAV-05/06 discovery contracts, NAV-09 replay handling, NAV-10 admission and NAV-11 scope; reuse NAV-02 refresh where required.

## Implementation increments

1. Add service-owned project/frontier records: owner scope/generation, canonical visited/pending pages, depth/page/byte/time limits, status/reason, found resources and provenance. Persist progress atomically and deduplicate repeated reports.
2. Add individually allowlisted browser discovery claim/page-result/status commands. The bridge exposes only the claimed project's permitted metadata, never generic crawl control or filesystem access.
3. Dispatch extension-controlled tabs through NAV-10 with discovery purpose and the selected session. Wait for bounded DOM readiness and adapter-declared rendering signals; extract permitted links/resources without submitting arbitrary forms.
4. Validate every result against base URL, scheme, scope, domain/depth/filter/size bounds and owner generation in the service. Cross-origin links require explicit permissions before another discovery tab opens.
5. Recover cancellation, tab close, browser absence, worker restart and source-session expiry. Keep authentication challenges visible and resume under the same scope, not an anonymous substitute.
6. On selected-resource download, request fresh session context and NAV-09 disposition. Replayable sources use engine transfer; stream-only sources use NAV-07/08. Do not create authenticated jobs with `RequestContext::default()`.
7. Add rendered/authenticated project controls, queue/wait status, found-resource selection, resume/cancel and six-locale messages in feature UI components.

## Tests and acceptance

- JavaScript-generated links absent from source HTML, delayed DOM, login-gated resource, loops, duplicate reports, max bounds, redirects and cross-domain permissions.
- Browser absent/reappearing and service/worker restart resume a persisted frontier without duplicate jobs; stale owners cannot inject resources.
- A selected rendered authenticated fixture completes the expected hash; a one-use resource follows the direct-stream path without another fetch.
- Deterministic replay yields the same selected resources/order. Existing static crawler remains covered.

## Scope boundary

Offline HTML/CSS rewriting, scheduled synchronization and universal site crawling belong to separate GRB/MGT work. Implement rendered discovery completely without silently extending this plan to the whole website-mirror roadmap. See [execution requirements](README.md).
