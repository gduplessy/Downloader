# FlareSolverr implementation plan

Implement an optional, local FlareSolverr service adapter with bounded asynchronous resolution, browser-profile ownership, temporary scoped cookies and matching User-Agent, automatic fallback for recognized browser protection, manual retry, and manual recovery for unsupported challenges.

Deliver in small verified commits: adapter and fixtures; engine/extension integration; settings and translations; qualification and Docker documentation. Each commit follows the repository product-version policy.

Research custom image-click CAPTCHA handling and 2Captcha CoordinatesTask separately. No paid requests, API credentials, external image uploads, or paid adapter are part of this increment. Record measured findings and remaining qualification gates without claiming universal CAPTCHA support.

Validate deterministic failures, sessions, cancellation, restart, source expiry, redirects, and hash-verified transfer. Qualify the existing local service and an isolated Docker deployment. Publish supported behavior and setup instructions after qualification, then open a PR against `feat/transfer-engine-correctness`.

## Approved implementation boundaries

- Fetch the requested feature branch, create `codex/flaresolverr-integration` in an isolated worktree, preserve the original checkout, commit verified increments, push and open an attached PR without merging.
- Disable solver settings by default; use `http://localhost:9191/` and 60 seconds. Add background-service connection/solve commands, desktop configuration/testing/version and a manual retry action.
- Classify browser protection separately from custom CAPTCHA, authentication, expiry, countdowns and ambiguity. After opt-in, attempt a recognized browser challenge once; never treat an ordinary 403 alone as a trigger.
- Preserve profile ownership and one workflow per host; suspend navigation during globally serialized solving. Discard cancellation, changed-page, changed-owner and changed-configuration results.
- Isolate job/origin sessions, clean them up, retain cookie scoping and matching User-Agent in temporary engine context, and exclude secrets/HTML from records, exports and diagnostics.
- Traverse confident GET links/forms with bounds; validate the final source through the engine. Keep file bytes in libcurl, reject unresolved/expired HTML and retain POST/blob/manual browser fallback.
- Recover interrupted solves with fresh context; complete all six locale dictionaries.
- Preserve g4u source provenance, treat supplied expired links as regressions, and specify serial custom CAPTCHA/host-selection/fresh-link grouping. Research local image methods and CoordinatesTask. Paid shipping requires demonstrated compatibility, separate opt-in, OS-keyring credentials and a spending ceiling.
- Run deterministic Rust/TypeScript/build/version checks; keep live qualification outside CI. Record health, challenge clearance, source resolution and verified transfer separately.
- Publish a digest-pinned loopback Compose service and standalone Docker setup/stop/upgrade/rollback walkthrough after fixture qualification. Keep actual live-site limits explicit in README, roadmap, compatibility and third-party/evidence documents.

## Delivery status

Adapter, navigation, settings/recovery/translations and qualification/documentation increments are implemented. The [qualification report](FLARESOLVERR_QUALIFICATION.md) records the actual tests and the [Docker walkthrough](FLARESOLVERR_DOCKER.md) covers the qualified image. [Custom CAPTCHA research](CAPTCHA_RESEARCH.md) remains a subsequent compatibility gate: no actual g4u challenge, fresh-link batch, downstream host or paid adapter is qualified. Real Cloudflare clearance and visible native/browser settings acceptance also remain open.
