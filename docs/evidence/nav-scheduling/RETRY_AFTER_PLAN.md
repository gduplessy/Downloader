# Retry-After ingestion implementation and remaining qualification

Production navigation-header ingestion is implemented and locally qualified on the recorded Windows Chrome/Edge builds in [RETRY_AFTER_INSTALLED.md](RETRY_AFTER_INSTALLED.md). Exact request and committed-document identity, fresh native scope/source authority, bounded initial-request adoption and monotonic server deadlines remain mandatory. Initial429 numeric and503 HTTP-date rows passed; broader owned-navigation matrices include malformed/oversized/repeated/distinct-longer deadlines and real worker replacement. Historical failed attempts and remaining acceptance boundaries are recorded separately. Date parsing currently accepts canonical IMF-fixdate only; obsolete RFC850/asctime forms remain unsupported compatibility work. Core file-transfer retry handling is a separate path.

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

## Chromium lifecycle correction (0.26.1)

Actual Chrome155 main-frame header events omit documentId; the initial strict header-only0.26.0 run rejected them and submitted early, so it is not acceptance. The corrected bridge requires optional webNavigation permission, links the latest exact request to an active committed top-frame document, and revalidates that document through the isolated world and fresh native authority. Later navigation intent/BFCache and replaced requests invalidate pending identity. Denied permission cannot provide resolver context.

For a freshly task-created tab, only its first bounded request may be adopted after the actual tabs.create receipt and native post-load scope/source claim; an intervening redirect/replacement fails closed. This does not reload or probe the original request. Duplicate response identity retains its deadline; distinct responses may extend but never shorten a surviving server deadline. Installed proof remains pending.

## First corrected installed row

The original-owned-navigation numeric429 row passed Chrome155 at checked3bc98f0 (extension30.0) with unchanged immutable native3b808ae/25.1: one original POST after the enforced12-second deadline, zero early/duplicate submissions and no original navigation replay. Actual response header documentId was absent; actual committed IDs were present. See retry-after-chrome-numeric-0.30.0.json. The30.1 candidate additionally preserves monotonic proof from readiness through commit after clock rollback; initial responses and the broader Chrome/Edge matrix remain pending until their own records pass.
