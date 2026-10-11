# NAV-09: replay risk and one-use ownership

## Outcome and baseline

Decide transfer ownership before consuming another request or cancelling the browser. Existing capture treats observed HTTP GET as replayable and hands it to an engine path that may inspect/start additional requests; GET method alone does not establish repeatability.

Owner: batch B. Dependencies: shared adapter/replay contract and NAV-11 scope. Direct streaming uses NAV-07/08.

## Implementation increments

1. Define `replayable`, `browser_stream_only`, `refresh_required` and `unknown` dispositions with evidence/reason and source generation. Adapters can declare single-use or session-bound semantics; a signed-looking URL alone does not establish either safety or risk.
2. Apply policy before native creation, metadata probing, range segmentation, recovery and pending-handoff reconciliation. Unknown/single-use sources cannot enter a path that performs an unqualified probe or duplicate request.
3. Preserve the existing durable/viable desktop acceptance boundary for qualified replayable requests. Route stream-only sources to NAV-07/08 without refetching; if streaming is unavailable keep browser ownership and explain the unmet lane.
4. Reconcile pending records using policy, owner and source generation after restart. Never cancel a browser-owned one-use transfer based only on a stale `viable` flag from another generation.
5. Add adapter-specific source refresh, token invalidation and bounded retry. Engine validators still prevent mixing remote revisions. Record original source and selected-host provenance independently of fresh secret request material.

## Tests and acceptance

- Consume-on-HEAD, consume-on-first-GET, POST-only, rotating-cookie, expiring-url and redirect-token fixtures count every request.
- Native failure before/after acceptance, cancellation races and worker restart never issue an unqualified second request or lose ownership information.
- A stream-only fixture reaches the correct desktop hash with one origin request; unsupported capture remains recoverable in the browser.
- Fresh-token refresh cannot append a changed remote file to old partial bytes; user restart decisions remain explicit.

See [shared execution requirements](README.md).
