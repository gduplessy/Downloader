# Downloader roadmap

Current product version: <!-- product-version -->0.30.2<!-- /product-version -->. Major stays at `0` until the full IDM parity acceptance gate is satisfied; see [version policy](../CONTRIBUTING.md#versioning).

NAV-11 review hardening (0.21.2) isolates private pending origins from regular cleanup and checks fresh native authority after queue admission before opening a source URL. Mutable caller snapshots cannot change frozen navigation intent. Current main's expiry regression and qualification histories are retained.

NAV-11 reviewed merge (0.21.3) preserves installed transfer qualification and [Firefox queued-container smoke evidence](evidence/nav-integration/firefox-scope-reviewed.json) from checked review fixes. Both native files match their distinct expected hashes; original user tabs remain open and no payload is refetched by native code.

NAV-11/NAV-12 partition qualification (0.22.0) integrates [actual Chrome/Edge partition evidence](evidence/nav-browser-streams/partition-qualification.md): two top-level sites in one profile/store, distinct matching native Blob hashes, and missing-cookie-permission refusal before job creation. Records retain their historical checked source and native revisions. Arbitrary embedded-frame capture and remaining audit gates stay pending.

NAV-08 recovery investigation (0.22.1) records [installed Firefox revoked-Blob evidence](evidence/nav-integration/firefox-revoked-blob.json). One run preserves zero bytes, no publication/refetch and WaitingUser, while an earlier settling run showed intermittent state drift. Actual daemon loss leaves a persisted nonterminal browser stream at BrowserDownloading after restart; repair and repeat acceptance remain pending.

NAV-08 abort recovery (0.22.2) retries an exact interrupted/detached stream after native downtime while preserving existing live-reader checkpoint reconnect semantics. Scope, owner, generation, epoch and tab fences remain required; installed service-loss repeat acceptance and intermittent revoked-Blob state drift are still pending.

NAV-08 service-loss repeat (0.22.3) passes installed Firefox158 on checked c6bd315: exact daemon restart, WaitingUser, 6,975,488 retained bytes with matching original-prefix hash, stable late progress and no publication/refetch. See [recorded evidence](evidence/nav-integration/firefox-service-loss-fixed.json). Intermittent revoked-Blob drift and full browser loss remain pending.

NAV-08 owning-tab loss (0.22.4) passes installed Firefox158 on checked d18f30e: WaitingUser with 90,112 original-prefix hash-verified retained bytes, stable late progress and one original producer GET. The original user source tab remains open. See [evidence](evidence/nav-integration/firefox-reader-loss.json); full browser loss remains pending.

NAV-08 interruption ordering (0.22.5) serializes resolver writes and Blob interruption transitions per owning tab, rejecting old control authorization after the matching interruption marker. Cross-tab concurrency remains available. Installed revoked-Blob repeat acceptance remains pending.

NAV-08 fixture synchronization (0.22.6) requires the actual interrupted capture marker and native WaitingUser before checking retained bytes. Native event timing shows the failed repeat observed preview state before stream admission; it does not prove marker removal or post-abort state drift. Strengthened installed repeat acceptance remains pending.

NAV-08 revoked-Blob repeat (0.22.7) passes two installed Firefox158 runs on checked 3e7167c with actual matching interruption marker, stable WaitingUser, zero-byte original-prefix verification, one original producer GET and no publication/refetch. See [evidence](evidence/nav-integration/firefox-revoked-admitted.json). Full browser loss remains pending.

NAV-07/NAV-08 browser-loss fixture (0.22.8) verifies actual isolated browser/native-host process exit while preserving the daemon, then checks bounded manual recovery and retained partials without browser restart or epoch mutation. Installed acceptance remains pending.

NAV-08 current cancellation (0.22.9) passes installed Firefox158 on checked 173e957: WaitingUser with 69,632 original-prefix hash-verified retained bytes, stable progress, one producer GET and no publication/refetch. Browser-loss shutdown controls are prepared before consumption because the first run completed before shutdown; full browser loss remains pending.

NAV-07/NAV-08 full-browser-loss evidence (0.22.10) reproduces a recovery gap on checked 653affe: verified browser/native-host exit, preserved daemon, and BrowserDownloading/nonterminal checkpoint after 120 seconds. The 880,640-byte retained partial matches the original prefix; no final publication or refetch occurred. See [negative evidence](evidence/nav-integration/firefox-browser-loss-negative.json). Bounded reader liveness repair and repeat acceptance remain pending.

NAV-07/NAV-08 reader liveness (0.22.11) adds 45-second monotonic reader leases, startup reconnect grace and ten-second exact-owner Begin keepalives without payload replay or offset advancement. Expiry retains the partial and fences late chunk/EOF. Focused native and extension regressions pass; full native verification and rebuilt installed browser-loss acceptance remain pending.

NAV-07/NAV-08 Firefox browser loss (0.22.12) passes installed Firefox158/Windows on checked be7484d and matching rebuilt native0.22.11: verified browser/native-host exit, preserved daemon, WaitingUser in 50.5 seconds, terminal checkpoint at 659,456 matching original-prefix bytes, stable progress and no publication/refetch. See [evidence](evidence/nav-integration/firefox-browser-loss-fixed.json). Full native152-test suite, strict Clippy/format and extension199 tests pass. Other browser targets, live-reader idle and peak-buffer acceptance remain separate.

This roadmap tracks implemented capabilities and remaining limitations stated in the README, compatibility matrix, acceptance evidence, and component notices. Optional FlareSolverr browser-challenge resolution is implemented; live-host qualification and custom CAPTCHA adapters remain open.

An unchecked item is unfinished. **Planned** means implementation work; **qualification** means evidence is missing even where code exists; **research** means feasibility and a supported approach must be established; **later** means outside the initial release matrix. Listing an item does not claim that it works today or promise universal website support.

The initial release still targets Windows 11 x64, macOS 14+ Intel and Apple Silicon, Ubuntu 24.04+ x64, and Chrome, Edge, Firefox stable, and Firefox ESR. Research and later-platform work can follow those release gates. No dates are promised before dependencies and acceptance requirements are understood.

## 1. Hosted download pages and challenges

Detailed [NAV plans and execution batches](plans/nav/README.md) cover the remaining scope of NAV-01 through NAV-13. These plans preserve implemented FlareSolverr support, require direct POST/blob streaming for supported lanes, and separate local fixtures from pending live-host/account and paid-provider qualification.

Shared navigation contracts are defined for the feature batches; all unfinished NAV implementation and qualification statuses remain open until their stated acceptance criteria pass.

Automatic startup coalesces against the actual isolated resolver document; explicit Continue still refreshes its claim. Blob capture states carry the exact session scope and source generation. Installed cancellation, replacement and private-session qualification remain active integration gates.

Desktop browser-source replacement now enters `WaitingUser` immediately and fences old stream frames/EOF. A native regression verifies durable partial ingress, counter advancement and no publication; installed replacement qualification remains pending.

Firefox response-filter queues are bounded across all outstanding events during admission and durable acknowledgement. The installed POST filter failure is still being investigated; this regression does not establish Firefox transfer acceptance.

Pending stream admission is fenced through cancellation and failed-filter cleanup. Firefox capture status separates refusal/interruption from verified EOF; the runnable installed ordinary-POST reproducer remains a failing qualification gate.

Blob document replacement aborts its scoped reader before resetting the resolver document marker; tab-close status retains its native fence until reporting finishes. Installed lifecycle evidence for these paths is still pending.

Worker startup/poll recovery terminates only exact current orphaned stream identities and retains durable partial progress. Installed worker-loss qualification is pending. The owner explicitly accepts the tested Firefox 157 binary form-navigation/download lane remaining pending while supported direct-stream lanes and PRs are completed.

Private ephemeral storage now namespaces primitive mappings and fences regular reads/removal/overwrite. Unqualified legacy primitive IDs stay hidden and untouched. Unit coverage verifies both lane separation and preserved legacy data; installed primitive-fencing qualification remains pending.

Latest main is reconciled through its adapter/scheduler merge. Shared three-digit countdown boundaries and resolver wait/authorization regressions are preserved under the current document nonce, source and claim protocol.

Coordinator staging combines versioned adapters, validated countdowns, the durable scheduler and bounded browser-stream storage while preserving separate batch PRs. Queue enrollment follows persisted job scope/source generations and validates per-tab recovery reports. Installed worker transport, preview cancellation and browser lifecycle acceptance remain pending integration checks.

Generation-qualified wait alarms and unresolved-task readmission are integrated. The scheduler report distinguishes real renderer/engine fixtures from installed-extension and live-host acceptance.

Final adapter preview cancellation, keyboard recovery and local qualification evidence are integrated; installed worker/session binding and downstream transfer acceptance remain coordinator checks.

One-use authorization lifecycle tests cover source/claim/document changes, expiry, cancellation and tab replacement. Production prepare/commit/cancel dispatch and installed-extension acceptance remain pending integration.

Scoped downstream-host/adapter metadata now survives normal service reopen and is rejected for stale owners, sessions, sources or pages. Private metadata remains transient; integrated worker persistence and transfer checks remain pending.

Original-response capture modules and persistent native transport are integrated with scheduler admission and sanitized wait recovery. Stable Chrome/Edge local byte hashes passed; actual full-worker preview/selection and Firefox capture remain separate gates.

| ID     | Capability and remaining scope                                      | Next work and completion criteria                                                                                                                                                                                                                                                                                                                                                   | Status                  |
| :----- | :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------- |
| NAV-01 | **Browser-challenge resolution via FlareSolverr**                    | Implemented: opt-in local adapter, desktop configuration/testing, automatic and manual attempts, owned sessions, scoped cookies/User-Agent, bounded GET resolution and browser recovery. Controlled rendered-page transfers are qualified. Remaining: real Cloudflare clearance, live source/downstream host matrix and visible desktop/browser acceptance; retain manual fallback. | Implemented / qualification |
| NAV-02 | Scoped account sign-in and manual MFA recovery                            | Add host-specific login detection, credential-store integration, authenticated-session refresh, and a clear browser handoff for MFA. Verify credential scoping, expiry, redirects, logout, and profile isolation.                                                                                                                                                                   | Implemented; local qualification |
| NAV-03 | Existing entitled sessions; live/API/bypass qualification open       | Add downloads through accounts with existing premium entitlements, account/session selection, and provider-supported APIs. Track bypass feasibility separately: establish a provider-supported or explicitly authorized approach before committing an implementation. Payment or entitlement checks remain visible; listing this item does not promise free access to paid content. | Implemented session path; APIs/live/research pending |
| NAV-04 | Waiting periods require a live browser tab                           | Improve countdown discovery, background wait/recovery, retry timing, and readiness notifications after sleep or restart. Research supported instant-download mechanisms on qualified hosts; do not report a wait as complete while a server still requires it.                                                                                                                      | Planned / research      |
| NAV-05 | Versioned adapters and explicit selection                         | Implemented candidate evidence, exact host matching, deterministic generic fallback, selected-host groups, stale DOM/session/version preview validation and six-locale keyboard UI. 120 synthetic Chromium DOM/request/hash checks, empty-layout recovery, cancel/claim-takeover rejection and keyboard/stale-preview fixtures passed; owned worker context is supplied by the stream integration batch. Live provider layouts remain unqualified. | Implementation / qualification |
| NAV-06 | Host compatibility and adapter maintenance                        | Four provider entries remain explicitly unqualified. Local synthetic layouts, GET/one-use POST hash fixtures, compatibility/evidence schema, contributor format and explicitly invoked read-only live smoke are implemented. Live provider/account and cross-browser release acceptance remain pending.                                                                                                                                            | Implementation / qualification |
| NAV-07 | Non-replayable POST requests remain browser-managed                  | Research safe browser-assisted transfer/import strategies that preserve method, body, tokens, and one-use semantics. Never retry a non-replayable submission as a guessed GET. Verify fallback completion and failure reporting.                                                                                                                                                    | Research                |
| NAV-08 | Browser-generated blobs cannot be replayed by the desktop            | Add browser-owned progress/completion tracking and explicit verified import/export where browser APIs allow it. Research a transfer path within the native-bridge permission model; do not assume a `blob:` URL is usable outside its page.                                                                                                                                         | Planned / research      |
| NAV-09 | One-use and session-bound requests may require browser ownership     | Detect replay risk before cancellation, preserve the browser transfer, and add provider-specific refresh/session recovery. Test token consumption, redirects, expired URLs, and transfer failure.                                                                                                                                                                                   | Planned / qualification |
| NAV-10 | Navigation is capped at three pages and one page per host            | Add configurable, host-aware navigation queues and transparent wait reasons. Preserve cookie/session integrity; qualify higher limits before allowing concurrent steps on the same host.                                                                                                                                                                                            | Planned                 |
| NAV-11 | Profile claims lack comprehensive privacy/container qualification    | Test private browsing, separate profiles, Firefox containers, partitioned cookies, competing workers, claim transfer, and extension-worker restart. Navigation context must never cross an unintended session boundary.                                                                                                                                                             | Qualification           |
| NAV-12 | Browser-driven rendered discovery is unfinished                      | Add extension-controlled discovery tabs, user-visible navigation state, and resume when a browser becomes available. Keep rendered discovery and final download handoff under the same session ownership rules.                                                                                                                                                                     | Implemented / qualification |
| NAV-13 | **Custom/image CAPTCHA adapters**                                   | Research local image processing and session-aware coordinate submission, including g4u host selection, scaling, replacement, CSRF continuity, expiry and fresh-link generation. FlareSolverr alone does not implement this custom interaction. Paid adapters require demonstrated compatibility, separate external-solving opt-in, OS-keyring credentials and a spending ceiling. | Research |

FlareSolverr service, owned navigation, desktop configuration, extension retry and six-locale recovery messages are implemented. The pinned local Docker deployment passed generated rendered-GET/cookie resolution and a SHA-256-verified 2 MiB range/resume fixture. Real browser-challenge clearance, custom CAPTCHA, fresh g4u links and downstream hosts remain unqualified. See [qualification](FLARESOLVERR_QUALIFICATION.md), [Docker setup](FLARESOLVERR_DOCKER.md), [CAPTCHA research](CAPTCHA_RESEARCH.md) and [the implementation plan](FLARESOLVERR_PLAN.md).

## 2. Transfer engine, correctness, and networking

- [ ] **ENG-01 — Protocol qualification (implemented; partial qualification):** HTTP/HTTPS, HTTP/2, FTP REST resume, explicit/implicit FTPS, redirects and capability diagnostics pass deterministic fixtures on Windows/macOS/Linux. A disposable Samba AD realm passes Windows/Linux NTLM and Linux Kerberos, including complete jobs and credential/ticket rejection (13 local checks; nine overlapping Linux checks also pass CI). Remaining: native macOS NTLM/Negotiate, Windows domain-based Kerberos, enterprise SSO variants and final shipped libcurl/installer provenance. See [realm acceptance](AUTH_REALM.md) and [published records](evidence/transfer-engine-2026-10-11/README.md).
- [x] **ENG-02 — Hostile response fixtures:** strict malformed/ignored range and header validation, HEAD fallback, unknown/empty/compressed streams, truncated bodies, unexpected full responses, Retry-After/throttling, changed/missing validators, expired/authenticated sources and portable Unicode filename coverage.
- [x] **ENG-03 — Large-file evidence:** actual 4,311,744,529-byte pause/reopen/resume/checkpoint/hash/publication passes on all three CI platforms; remote ZIP64 central-directory offsets above 4 GiB are verified.
- [x] **ENG-04 — Connection pooling:** bounded session/routing-isolated reuse, host/global admission and concurrency backoff; repeated single/segmented measurements include server caps and hashes.
- [x] **ENG-05 — Recovery fault injection:** ten actual subprocess termination boundaries cover partial creation, checkpoints, verification, assembly/publication, scanning and staged copies. Recovered output hashes match; no falsely completed jobs.
- [x] **ENG-06 — Filesystem failures (documented matrix qualified):** durable ownership/offsets, filename/path validation, collision/overwrite protection, write/flush injection, Windows locks, Unix aliases and recoverable copies are covered. [Real filesystem CI](https://github.com/gduplessy/Downloader/actions/runs/38108936320) passes actual disk-full/restart, readonly-file refusal/recovery and cross-volume publication/collision preservation on Windows NTFS, macOS HFS+ and Linux ext4 disposable volumes. This does not claim every filesystem or native installer is qualified.
- [ ] **ENG-07 — Networking controls (routing/failover implemented; policy qualification remains):** HTTP/HTTPS CONNECT, SOCKS4/5/5h, platform PAC, Basic/Digest and redirect isolation fixtures pass. [Three-platform CI](https://github.com/gduplessy/Downloader/actions/runs/38108335654) passes ordered failover, explicit direct fallback and exhausted/TLS/authentication refusal (44 Windows / 43 Unix network/performance cases). Lists are bounded to 16 routes; only pre-response connection failures advance. Windows implicit loopback bypass is refused in explicit PAC mode. Remaining: enterprise system/PAC/WPAD/bypass policies, proxy SSO and the native authentication matrix beyond the qualified Docker-realm clients.
- [x] **ENG-08 — Expired-source recovery:** typed authentication/expired/changed/resume failures with recovery actions, profile-owned browser refresh and explicit restart decisions; fixtures prevent incompatible byte merging. Stable-browser acceptance remains WEB work.
- [x] **ENG-09 — Public control protocol:** transactional typed/sequence events, snapshot-first reconnect/replay, negotiation, durable idempotency/tombstones, CLI watch and browser-safe creation/refresh/event projection. Real native-messaging and CLI/service fixtures pass on Windows/macOS/Linux, including repeated creation, privacy, pause/resume and service restart. Native GUI/browser matrix remains separate WEB/REL work.
- [ ] **ENG-10 — Performance evidence (partial):** throughput, engine CPU/RSS, checkpoint, verification and finalization measurements and reproducible fixtures are published. Remaining: successful IDM comparison. Installed IDM produced zero fixture requests/output in two 180-second attempts; no comparative result is claimed.

Patches 0.2.1–0.2.5 add Windows bypass wildcard/boundary and case-insensitive protocol-map regressions, real malformed-range fallback, encoded Unicode filenames, browser-safe native creation/refresh responses, primary-failure preservation across cancelled sibling connections and actual Last-Modified validation when ETags are weak. See [implementation, measurements and sanitized evidence](TRANSFER_ENGINE.md). Checked engine items establish their deterministic acceptance criteria, not full native/browser/install acceptance or universal website support.

## 3. Download management, queues, and scheduling

- [ ] **MGT-01 — Editable job properties:** destination, filename, category, queue, priority, description, and safe updates to active/partial jobs.
- [ ] **MGT-02 — Table customization:** configurable columns, saved sort/filter state, selectable actions, and keyboard-accessible selection.
- [ ] **MGT-03 — Input workflows:** complete drag/drop, optional floating drop target, clipboard opt-in, duplicate decisions, destination rules, batch lists, and numbered-template edge cases.
- [ ] **MGT-04 — Archive preview:** qualify remote ZIP/ZIP64 inspection against real archives, malformed records, missing range support, and large/Unicode entries.
- [ ] **MGT-05 — Ordered queues:** persistent ordering, priorities, per-queue concurrency, restart/sleep recovery, and visible queue-control behavior.
- [ ] **MGT-06 — Advanced schedules:** recurring windows, start/stop behavior, time zones, DST transitions, missed windows after sleep, and predictable catch-up policy.
- [ ] **MGT-07 — Periodic synchronization:** reliable remote-file comparison, changed-file decisions, interrupted synchronization, and scheduled refresh without duplicate output.
- [ ] **MGT-08 — Unified limits:** speed limits and rolling quotas for file, media, crawler, and processing workflows; include media subprocess accounting and exact-limit recovery.
- [ ] **MGT-09 — Import/export acceptance:** native desktop save/open workflows, schema/version handling, duplicate request IDs, invalid entries, and privacy-safe exported lists.

## 4. Browser integration

- [ ] **WEB-01 — Automatic capture:** qualify ordinary downloads, redirects, exclusions, force/bypass shortcuts, duplicate click/request/download events, completed downloads, and unsupported request reasons.
- [ ] **WEB-02 — Browser fallback:** test missing/crashed native hosts, failed/slow desktop acceptance, cancellation races, worker restart, and successful browser completion without lost downloads.
- [ ] **WEB-03 — Session handoff:** verify ordinary/partitioned cookies, Firefox containers, private browsing, relevant headers, temporary context cleanup, cross-origin redirects, and saved-session opt-in.
- [ ] **WEB-04 — Page tools:** qualify selected/page links, context menus, media panel/overlay, site permissions, disabled capture, and integration diagnostics.
- [ ] **WEB-05 — Native-host onboarding:** remove the need for manual host registration during a supported install; verify identity allowlists, multi-profile registration, diagnostics, repair, upgrade, and uninstall.
- [ ] **WEB-06 — Chrome and Edge:** run the full acceptance suite on stable browsers for every initial desktop target. Chrome for Testing evidence alone does not qualify these rows.
- [ ] **WEB-07 — Firefox and ESR:** test the Firefox adapter, permission flow, native messaging, containers, and recovery; obtain Mozilla signing for permanent installation.
- [ ] **WEB-08 — Store distribution:** prepare, submit, and qualify Chrome Web Store, Edge Add-ons, and Firefox listings; document sideloaded development builds separately.
- [ ] **WEB-09 — Bridge boundaries:** fuzz malformed/oversized messages, unauthorized origins, privileged commands, unrelated-job access, and secret redaction; preserve metadata-only native messaging.

## 5. Media and protected content

- [ ] **MED-01 — Deterministic media workflows:** MP4/WebM, separate tracks, HLS/DASH, quality/container selection, remuxing, audio extraction, thumbnails, metadata, and subtitles.
- [ ] **MED-02 — Playlists:** selection, ordering, naming/collisions, per-entry failures, cancellation, resume, and shared limits.
- [ ] **MED-03 — Live recording:** qualify supported live sources, user stop, interruption recovery, partial recording finalization, and explicit unsupported-source reporting.
- [ ] **MED-04 — Processing recovery:** supervise subprocess trees, persist intermediate files, recover interrupted assembly, cancel cleanly, and report dependency failures as actionable states.
- [ ] **MED-05 — Media sessions:** authenticated inspection/downloads, credential scoping, expired session/link refresh, and safe browser context handoff.
- [ ] **MED-06 — Bundled dependencies:** ship pinned yt-dlp, FFmpeg/ffprobe, Deno, and matching EJS on all initial platforms; no separate Python/JavaScript installation or manual component setup for ordinary users.
- [ ] **MED-07 — Component updates:** verified versioned component releases, rollback, compatibility tests, immutable build inputs, and exact source/notices for bundled binaries.
- [ ] **MED-08 — DRM-protected media support / circumvention request:** track as research outside the initial launch scope. Evaluate provider-supported offline downloads or authorized export paths and clearly report protected-content limits. Generic DRM removal is not an implemented or committed capability.
- [ ] **MED-09 — Live-site compatibility:** maintain an extractor/site matrix and optional changing-site smoke tests separately from deterministic CI. A working adapter is not evidence for every website.

## 6. Website grabber and offline copies

- [ ] **GRB-01 — Authenticated crawling:** credential/session scope, expiry, login refresh, and profile/container handoff.
- [ ] **GRB-02 — Rendered projects:** extension-controlled browser discovery, JavaScript-generated links/resources, browser-unavailable waits, and resumable projects.
- [ ] **GRB-03 — Durable frontier:** persist discovered/visited URLs, resumable crawling, bounded concurrency, cyclic links, and interrupted selection/download state.
- [ ] **GRB-04 — Project controls:** saved templates, crawl depth, domain/path filters, type/size filters, selection preview, deduplication, and collision-safe destinations.
- [ ] **GRB-05 — Resource discovery:** CSS imports/URLs, HTML references, redirects, character encodings, and relative/base URL handling.
- [ ] **GRB-06 — Offline rewriting:** rewrite downloaded HTML/CSS links, preserve directory relationships, and verify navigation from local files. Report resources requiring a live backend; a static copy cannot reproduce an unavailable server application.
- [ ] **GRB-07 — Scheduled synchronization:** incremental changes, deletions/rename policy, interrupted runs, shared quotas, and evidence that unchanged resources are reused safely.

## 7. Desktop integration, languages, and accessibility

- [ ] **UI-01 — Notifications:** readiness, transfer/processing completion, failures, authentication/challenge prompts, and notification preferences.
- [ ] **UI-02 — Sleep inhibition:** prevent sleep only while configured active jobs need it; restore normal behavior after pause, failure, completion, and Quit.
- [ ] **UI-03 — Optional autostart:** implement the opt-in workflow and qualify enable/disable, tray startup, upgrade, and uninstall.
- [ ] **UI-04 — Completion actions:** explicit configuration, safe cancellation, scanner execution, scan failures, queue completion, and auditable action results.
- [ ] **UI-05 — Native integration:** open/reveal completed output, tray/show/Quit behavior, platform download-security metadata, scanner compatibility, and visible workflow acceptance.
- [ ] **UI-06 — Accessibility:** keyboard-only operation, focus restoration, dialogs/table semantics, screen readers, contrast, zoom, and motion preferences.
- [ ] **UI-07 — Six verified translations:** native review of English, French, Spanish, German, Arabic, and Simplified Chinese; translate backend messages/default categories and qualify Arabic RTL in desktop and extension.
- [ ] **UI-08 — Integration health:** host/browser/component versions, actionable recovery, redacted diagnostics export, and a searchable settings experience.
- [ ] **UI-09 — CLI installation:** package the CLI alongside supported desktop distribution with documented PATH/absolute-path usage and JSON output acceptance.

## 8. Platform qualification, packaging, and release

| ID     | Target or release gap   | Required evidence / dependency                                                                                                                                         |
| :----- | :---------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-01 | Windows 11 x64          | Fresh install, native GUI workflows, stable-browser capture, tray, installer execution, upgrade, and uninstall.                                                        |
| REL-02 | macOS 14+ Intel         | Source build, DMG, native GUI, components, security metadata, native-host registration, browser matrix, install/upgrade/uninstall.                                     |
| REL-03 | macOS 14+ Apple Silicon | Independently qualify the Apple Silicon build and the same native/browser/component workflows.                                                                         |
| REL-04 | Ubuntu 24.04+ x64       | Source build, DEB/AppImage, webview/system dependencies, credentials, tray behavior, native-host registration, browser matrix, install/upgrade/uninstall.              |
| REL-05 | Public binary release   | Signed installers/update metadata, verified downloads, changelogs, rollback, and release identifiers. Signing credentials are external prerequisites.                  |
| REL-06 | Dependency provenance   | Exact pinned source/build recipes, FFmpeg flags/patches/dependencies, complete notices, corresponding-source archives, Rust/JavaScript SBOMs, and checksums.           |
| REL-07 | Continuous integration  | Passing source builds/tests on all initial targets, reproducible dependency setup, artifacts, and recorded results. CI does not replace native GUI/browser acceptance. |
| REL-08 | Publishing identity     | Validate public branding, native host/application identifiers, extension signing/store accounts, and owner-controlled release infrastructure.                          |
| REL-09 | Public launch gate      | No unfinished required workflows, no silent corruption or lost-download failures, and acceptance evidence for every supported platform/browser combination.            |

## 9. Additional platforms and legacy capabilities

These unsupported targets and capabilities are now explicit roadmap entries. They are lower priority than the initial release and need a separate feasibility/maintenance decision.

- [ ] **FUT-01 — Brave and Opera:** browser compatibility, host registration, permissions, capture/fallback, and published acceptance rows.
- [ ] **FUT-02 — Safari:** research a Safari extension/native-app integration and its capture limitations; qualify it before claiming support.
- [ ] **FUT-03 — Windows ARM and additional desktop architectures:** native dependencies, components, installers, and complete acceptance rather than assumed emulation compatibility.
- [ ] **FUT-04 — Mobile operating systems:** research Android/iOS application architecture, background-transfer constraints, browser integration, and store distribution. Desktop Tauri builds do not qualify mobile support.
- [ ] **FUT-05 — MMS and other legacy protocols:** assess actual demand, available maintained libraries, test fixtures, and support costs before committing implementation.
- [ ] **FUT-06 — System-wide download interception:** research opt-in OS integrations for applications outside supported browsers, explicit permission boundaries, and reliable ownership/fallback. Arbitrary kernel interception remains outside the initial release.
- [ ] **FUT-07 — Dial-up/legacy connection management:** assess whether modern connection-aware queue controls cover the use case; native legacy dial-up control requires a separate platform feasibility decision.

## 10. Intentional product controls to preserve

The README also states constraints that are product or correctness controls, rather than missing functionality. They remain visible here so that the limitation audit is complete:

| Current constraint                                                | Roadmap treatment                                                                                                                                    |
| :---------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| No accounts, advertising, or telemetry                            | Preserve local operation; do not introduce a hosted account requirement or tracking dependency while adding features.                                |
| No public HTTP control server                                     | Preserve restricted per-user IPC; new integrations must have an explicit permission/identity model.                                                  |
| Capture and all-site access are opt-in                            | Improve onboarding and per-site controls without silently broadening browser permissions.                                                            |
| Browser session material is temporary                             | Add explicit save/forget controls only where required; test cleanup and profile isolation.                                                           |
| Embedded URL credentials are rejected                             | Provide usable credential-store/authentication workflows instead of leaking credentials through URLs, histories, or diagnostics.                     |
| Restart discards partial bytes explicitly                         | Keep restart decisions visible; never silently merge unvalidated remote content or report corrupt output as complete.                                |
| Browser download cancellation waits for viable desktop acceptance | Keep browser fallback and ownership tests as release gates for every new capture path.                                                               |
| A static offline copy cannot replace a live backend               | Report the missing dependency and investigate supported export flows; do not claim that HTML rewriting recreates a server application.               |
| IDM registration/licensing mechanics and assets are absent        | Keep original code, branding, and GPL distribution; the roadmap targets functional workflows rather than another product's license checks or assets. |

## Evidence and maintenance

- Record completed checks in [ACCEPTANCE.md](ACCEPTANCE.md), naming the actual platform/browser, test, artifact, and result.
- Update [COMPATIBILITY.md](COMPATIBILITY.md) only after that target is qualified.
- Keep [IMPLEMENTATION.md](IMPLEMENTATION.md) as the concise current-state summary; this document is the full unfinished-work inventory.
- When a limitation is added to the README or status documents, add or reference its roadmap ID. Research items need a feasibility decision before becoming release promises.

NAV-04 / NAV-10 implementation increment: durable scheduler policy and wait clock regression fixtures added; browser integration and qualification remain in progress.

NAV-04 / NAV-10 browser increment: service admission and extension queue controls integrated; 25 extension checks plus service restart/profile/private-state regressions pass. Live host, stable browser and resource acceptance remain pending.

NAV-07/08/09/11 implementation increment (0.7.0): durable direct-response receiver, strict replay policy, generation fences, scoped projections and transient private records implemented. Real extension transport/browser matrix, private legacy-history review and live-provider acceptance remain pending.

NAV-13 increment 0.10.0: local geometry/lifecycle and durable mocked paid-provider accounting implemented. Browser submission, fresh selected-host links, intended-hash and live acceptance remain separate pending gates.

NAV-01 local Rust solver lifecycle: 7/7 fixtures pass. NAV-13 synthetic corpus 120/120 unique accepted-correct images, 80/80 negative abstentions; 4/4 fresh selected-host desktop files match intended SHA256. Installed extension challenge path and live/paid qualification remain pending.

NAV-01 production settings controls: local enable/save/test/stale-setting invalidation/disable/restart pass in the browser component harness backed by isolated native state. NAV-13 form/host/occlusion fences pass eight stale DOM cases with zero submissions. Installed extension acceptance remains pending.

NAV-04 / NAV-10 qualification increment: production queue UI and actual Engine policy verified with three/twenty real fixture renderer tabs, limit lowering, same-host locking and replaced-wait/restart lifecycle. [Evidence and pending scope/browser/live-host gates](evidence/nav-scheduling/README.md).

NAV-12 increment 0.11.0: scoped durable frontier and bounded report persistence implemented; rendered browser controls and authenticated resource acceptance pending.

NAV-12 0.11.1 adds rendered extraction, session controls and safe staged resource selection; complete extension/native fixture acceptance is pending.

NAV-12 0.11.2 integrates production discovery commands and owned tabs. Selected one-use resources reopen their provenance page and authorize only the intended original control before any capture; installed browser hash acceptance is pending.

NAV-12 0.11.3 binds explicitly permitted cross-origin pages and resources to their observed partition; browser epoch recovery is fenced. Installed rendered/authenticated acceptance remains pending.

NAV-12 0.11.4 adds installed-browser qualification commands and real Engine shared-budget/cross-origin regressions; production worker capture and resource SHA-256 acceptance remain pending.
NAV-13 runtime integration: production worker and resolver hooks added with a live isolated document nonce, native selected-host metadata, scheduler admission and original browser HTML form submission. Installed fixture acceptance is in progress.

Shared integration 0.8.10: adapter actions now prepare one-use authorization before capture, recheck current page/session/source authority before commit, and abort cancelled capture. Selected provider metadata is recorded through the scoped native command; rendered-discovery navigation opens the selected resource while retaining its provenance page. Full installed-worker acceptance remains pending.

Shared integration 0.8.11: same-context read-only authority renewal adopts claim/source replacements and invalidates old grants/capture. Recovery, heartbeat and tab closure require current browser epoch and actual owned session; stale tab IDs do not authorize a substituted context. Scoped refreshed sources remain in browser navigation until replay qualification. Installed-worker/private-session acceptance remains pending.

NAV-13 installed qualification driver added against the combined production worker/resolver. Browser startup and scoped capture acceptance are still under investigation; no live or paid success is inferred.

Shared integration 0.8.12: private and regular scheduler responses and reconciliation are isolated by explicit worker lane, while capacity and host locks remain service-global. Six native scheduler regressions cover lane isolation, retained peer leases, durable private exclusion, authority replacement and queue recovery.

NAV-12 0.11.5 binds live document proofs and selected-source admission, with bounded desktop resource paging. Native regressions pass; installed original-stream acceptance remains pending.
Shared integration 0.8.13: scoped incremental subscriptions preserve null snapshots; cached subscription cursors recover on scope/claim changes. First production installed Chrome 155 POST gate passes one original submission, 262,161 bytes and native SHA-256. Broader installed blob/cancel/replacement/private/container/Firefox and integrated account/challenge/discovery acceptance remains pending.

NAV-12 0.11.6: full Rust/client tests and Clippy pass. Fresh scoped selection snapshots and exact dynamic-resource readiness are implemented; installed capture qualification remains pending.
NAV-13 canonical scope and CLI-created navigation ownership corrections integrated; actual installed acceptance remains under investigation with no inferred success.

Shared integration 0.8.13: scoped incremental subscriptions preserve null snapshots; cached subscription cursors recover on scope/claim changes. First production installed Chrome 155 POST gate passes one original submission, 262,161 bytes and native SHA-256. Broader installed blob/cancel/replacement/private/container/Firefox and integrated account/challenge/discovery acceptance remains pending.

NAV-13/adapter integration 0.10.6: current document claims are required for prepare/commit/disable; nonce-keyed grants reject same-URL replacement. Full native/client checks pass; installed challenge qualification is still active.

NAV-12 0.11.7: installed Chrome155 delayed/authenticated discovery and one original GET matched native SHA-256 on base4001f58. Final combined-base, Edge and remaining release-matrix acceptance are tracked separately.
Shared integration 0.12.0: serialized metadata writes prevent stale source/claim replacement in regular and private lanes. Chromium restart reconciliation resolves actual cookie-store membership. 106 extension regressions, types and both browser builds pass; broader installed acceptance remains pending.

NAV-12 0.11.8 adopts checked common base9dc9986. Installed Chrome/Edge qualification is being refreshed; live hosts/accounts and remaining platform/browser matrix stay pending.

NAV-13 0.10.7: fixed Chromium canvas proof drift, required genuine current document claims, and rejected late host-choice cancellation callbacks. Local stale-case fixture passes twelve scenarios; installed final desktop hashes remain pending.

Shared integration 0.12.1: removal event projection preserves owner/private/exact claim and rejects unqualified historical tombstones. Real engine coverage confirms isolation in both browser lanes and after claim replacement.

Shared integration 0.12.2: direct stream ownership prevents competing legacy download handoffs. 13 stream tests, extension types/builds and actual Chrome original POST hash verification pass. Installed Firefox and broader acceptance remain pending.

NAV-12 0.11.9 integrates direct-stream observer ownership and current session startup fences from basebd6cf35; final installed fixture evidence is being refreshed.

NAV-13 integrated observer ownership in 0.10.8; no frame, source or document gate is relaxed. Final installed directGET qualification remains active.

Shared integration 0.12.3: adopt serialized job startup and claim-before-heartbeat persistence; retain Firefox request listeners through filter completion and reject terminal-stream revival. 33 session/stream regressions pass; actual Firefox acceptance remains open.

Shared integration 0.12.4 adopts account metadata/credential/premium flows with exact live document and scheduler authority, preserving challenge and stream hooks. Extension/desktop/native tests, types, builds and strict Clippy pass; installed combined qualification continues with live/paid boundaries unchanged.

### NAV-02/03 account foundation (0.9.0)

Desktop account creation/selection/removal, exact-session metadata, OS-keyring references, typed auth/entitlement recovery and one-use expiring grants are implemented. Browser form integration, native credential lifecycle and downstream file-hash acceptance remain in progress. Live host/account qualification and provider APIs remain pending.

Account grant and credential lifecycle qualification (0.9.1): Windows OS-keyring save/read/remove and the production Engine one-use grant path pass with deleted test-only credentials. Form cancellation, request overrides and stale documents are covered by real Headless Chromium DOM checks with mocked grant transport. Installed-extension/native downstream acceptance and live/provider account qualification remain pending.

Account browser wiring (0.9.2) uses the owned resolver context for observations and one-use login fills, native selected-session entitlement checks, visible recovery, exact document/source/claim fencing, and cancellation. Combined installed-worker/file-publication qualification is in progress; no live provider or API qualification is claimed.

Account authority integration (0.9.4) adopts intentional source/claim changes only in the original session, supports explicit saved-account edits, validates actual Chromium document identity before grants, and rechecks premium account/revision at capture commit. Owned authenticated observations retain original provenance across redirects. Installed worker qualification is in progress.

Account integration (0.9.5) uses canonical native/browser partition comparison and the exact scheduler private lane. Installed production worker authentication/premium acceptance is being qualified with local permitted files.

Selected account recovery (0.9.6) preserves an explicit account only through same-session owner continuation/refresh, renews nonsecret association fences, invalidates earlier grants and observations, and retains bounded sign-in attempts. Installed worker authentication/premium acceptance remains in progress.
Account integration (0.9.7) includes authority-qualified incremental browser snapshots and the checked production Chrome capture prerequisite. Installed Chrome 155 local fixtures pass both explicit saved-fill sign-in and existing-session premium download through actual extension/native transports, publishing 311,296 hash-verified bytes with one login and one file request. Edge qualification remains pending after a recorded zero-byte continuation failure; live hosts, provider APIs, Firefox and other OS rows remain pending.
Account document proof (0.9.8) binds native credential grants and premium capture to the actual isolated document nonce and generation, plus Chromium document ID when available. The nonce-protected Chrome 155 saved-fill fixture publishes the expected verified bytes. Edge 155 baseline saved-fill passed; its final nonce-protected row and Firefox remain pending further integration.
Account staging integration (0.9.9) adopts the checked monotonic navigation-record guard, deep-cloned private memory storage, actual Chromium cookie-store reconciliation and E challenge document contract. Credential and capture grants keep distinct purposes and require the current verified nonce. Final installed account reruns follow this shared prerequisite update.

NAV-12 0.13.0 adds bounded original-session provenance preparation for selected cross-origin resources. Installed Chrome local cross-origin and active-frontier service/worker restart qualification passes with one authenticated original GET and the expected native SHA-256; final browser evidence and pending release rows are recorded in [discovery qualification](evidence/nav-discovery/README.md).

Account response ownership (0.9.10) adopts checked direct-stream ownership and removal-event isolation. Installed account qualification asserts selected downstream provider and original provenance through authenticated redirect and native hash publication. Live hosts/accounts and APIs remain pending; [browser/OS acceptance](evidence/nav-accounts/README.md) distinguishes installed fixtures from DOM mocks.


NAV-13 0.10.9: canonical native HOST used by control and byte ports; invalid source counters refuse capture. Installed Chrome 155 passes four original local CAPTCHA POSTs, fresh selected-host links and 253,952-byte desktop hashes with diagnostics off and zero paid calls. Twelve stale/cancelled DOM cases submit zero times. Live, paid and broader browser/platform gates remain pending; see [challenge evidence](evidence/nav-challenges/README.md).

NAV-12 0.13.1 preserves explicit original-session ownership across a complete browser-process restart. New epochs refuse automatic adoption; explicit resume renews the old scheduler lease before reopening approved provenance. Checked shared base 91d0553 keeps live resolver previews stable.

NAV-12 0.13.2 reconciles checked root 7e44b00/latest main. Clean committed-source Chrome 155 and Edge 155 both pass cross-origin authenticated discovery with full browser/service/worker restart and expected native hash. Live provider, Firefox/ESR, other OS and owner UI acceptance remain pending.

NAV-12 0.13.3 records final clean committed-source 7f752d3 Chrome/Edge cross-origin and complete restart evidence. Both finish one authenticated original GET, zero HEAD and 262,161 hash-verified native bytes. Documentation/version-only increment; remaining release acceptance rows stay explicit.

NAV-07/08/09/11 production qualification increment (0.14.0): installed Chrome/Edge Blob-to-native hashes and specific cancellation/replacement/private rows are recorded in [the full-worker matrix](evidence/nav-browser-streams/README.md). Worker/service/browser recovery, complete profile/partition/container qualification and Firefox/live-provider acceptance remain pending; these passing fixture rows do not close the roadmap items.

NAV-07/08/09/11 qualification increment (0.14.3): installed Chrome worker termination preserves durable progress; native-service restart reaches safe manual reauthorization with a verified original partial prefix. Actual Chrome/Edge private Blob hashes and the labeled split-storage primitive probe pass. Fresh production Blob evidence captures selected native-host/daemon SHA independently of CLI version. Complete browser restart, cross-session transfer, full profile/container/partition races, actual private menu UI and broader browser/platform/live-provider acceptance remain pending; see [evidence](evidence/nav-browser-streams/README.md).

NAV-11 session-transfer integration (0.16.0) adds native pending/manual-recovery gates, transient one-use tickets, and explicit recipient acceptance using the destination tab's actual cookie/container/partition scope. Native compilation and focused recipient tests pass; desktop controls and installed cross-session qualification remain in progress.

NAV-07 original-response progress (0.16.1) rejects late renderer status resets during an exact owned stream and suppresses repeated resolver decisions. Fifteen native stream and nine handoff regressions pass; corrected installed Firefox XHR source/hash qualification is pending.

NAV-07 supported Firefox page-owned XHR passes its installed Windows stable157 exact-source/native hash row; ordinary binary main-frame form/download remains owner-selected pending. NAV-11 handoff storage-failure recovery is bounded, retryable, exact-fenced and monotonic; installed cross-session qualification remains in progress.

NAV-11 desktop handoff controls (0.18.0) complete native/recipient wiring and handle live pending projections without discarding a legitimate reply. Fifty desktop transfer regressions cover authority, expiry and cancellation. Installed cross-profile/container qualification is still in progress.

NAV-07 Edge qualification (0.18.1) completes one original binary attachment POST through installed Edge 155 and the production native sink, with 8,388,625 hash-verified bytes. Other POST/lifecycle rows remain separate; see [installed evidence](evidence/nav-integration/production-edge-post.json).

NAV-04 production clock integration (0.18.2) uses monotonic alarm/poll rechecks during a live worker and durable UTC recovery after restart. Repeated observations remain bounded and generation-fenced; every wake still requires fresh page/server readiness. Installed wait/alarm qualification remains pending.

NAV audit (0.18.3): [remaining acceptance by plan](plans/nav/IMPLEMENTATION-AUDIT.md) records local integration gates separately from live, paid, unavailable-platform and explicitly deferred Firefox binary-form rows. Implementation PRs alone do not close these gates.

NAV-11 queued-source retention (0.21.0) separates pending user origins from owned resolver records, validates actual source context before admission, and requires explicit recovery after source loss or transfer. Firefox158 sequential container hashes pass; the reproduced queued-container substitution and corrected installed qualification are tracked separately in docs/evidence/nav-integration/firefox-scope*.json.

NAV-11 Firefox scope qualification (0.21.1): checked af318b9 extension21.0/native16.1 on Firefox158 passes actual sequential and queued container Blob hashes plus lost-source WaitingUser with zero replacement bytes or payload requests. Normal scheduler polling drives recovery; original user tabs remain open. Initial activation invokes the registered context-menu handler with actual browser metadata; native context-menu UI and private-addon permission acceptance remain pending. See docs/evidence/nav-integration/firefox-scope-queued-fixed.json and firefox-scope-missing-source.json.

NAV merge review (0.18.4) reconciles stream qualification, handoff UI/wait timing and deterministic native Windows expiry checks; runtime acceptance boundaries remain as documented in the audit.

NAV-11 expiry regression (0.16.3) uses deterministic monotonic observation at the exact five-minute boundary, removing fresh-Windows-runner uptime underflow without weakening the expiry assertion.

NAV stream merge reconciliation (0.16.4) retains the installed stream/private-recovery qualification records alongside current handoff authority and native expiry behavior. Pending local and release acceptance rows remain explicit.

NAV-11 installed transfer increment (0.19.0): actual regular Chrome/Edge profiles complete different cookie-derived native files at the same URL after explicit receiver options preview/accept; old scope/status/stream/account/CAPTCHA operations and token reuse are refused. The [matrix](evidence/nav-browser-streams/transfer-qualification.md) labels guarded desktop-IPC preparation and keeps full browser restart, private/container/partition combinations and live/provider acceptance separate.

NAV reconciliation (0.19.1) preserves reviewed handoff UI/monotonic waits and installed two-profile native hash proofs. The unfinished desktop GUI mode is excluded; stopped ComputerUse does not qualify Prepare/Cancel/Copy, and full browser-process loss remains a required local gate.

NAV-05 installed local negatives (0.24.0): actual Chrome 155 and Edge 155 each passed trusted adapter disable with conservative generic preview and changed-layout stale-selection refusal. All four cases had zero payload/purchase requests and no publication; exact historical runtime/native fingerprints and initial activation limits are in docs/evidence/nav-adapters. An intermittent refresh ownership-observation failure is being fixed separately; no live-host acceptance is claimed.

NAV-05 recovery correction (0.24.1): keep stale Refresh controls visible when owned-context observation fails, and coalesce overlapping refreshes into a fresh observation after the active step. Old selection authorization remains rejected; post-fix installed repetition is tracked separately.

NAV-05 recovery 0.24.2 preserves stale controls through the full asynchronous preview replacement, including worker-step rejection. Installed post-fix acceptance remains separately tracked.

NAV-05 local post-fix qualification (0.24.3): both adapter-disable fallback and changed-layout refusal passed actual installed Chrome/Edge controls at checked runtime 2656b52. Exact native states, historical build hashes and remaining live-host/platform boundaries are recorded in docs/evidence/nav-adapters/INSTALLED-NEGATIVES.md.

Installed Chromium scheduler readiness, actual worker-restart alarms, default-three/configured-twenty admission and sampled resources: [reproduction and remaining gates](evidence/nav-scheduling/INSTALLED.md).

Scoped cancellation passed installed Chrome/Edge checks on 0.23.2. Unadmitted cancellation requires the canonical owner and exact source; its installed 21st-row qualification passed on checked 3d6bd4d/native0.23.4. Combined integration-build repetition remains separate.

Cancellation now preserves the native terminal state across EOF-control registration and finalization races; Retry-After browser-navigation ingestion remains pending.

Queued cancellation revalidates the current scheduler owner at native commit; a replaced queued owner cannot cancel through a stale snapshot.

NAV integration 0.25.0 combines adapter recovery, browser-reader liveness and authority-fenced cancellation. Deterministic context/queue/EOF/publication race tests preserve Cancelled and original partials; installed qualification remains tied to each recorded build.

NAV-05 recovery 0.24.5: Cancel/Escape invalidates pending retained-preview replacement and pre-Cancel coalesced refreshes through the actual close lifetime. Later explicit Continue still obtains fresh owned context; deterministic context/worker-step cancellation cases cover no resurrection or stale-authority submission. Historical installed evidence retains its exact checked versions.

Installed scheduler cancellation (0.25.2 evidence) passes actual Chrome/Edge scoped cleanup and Chrome unadmitted 21st-row authority/peer preservation on exact combined runtime/native3b808ae (0.25.1). Both scoped runs and queued repetition exit zero; fixture-only esbuild cleanup and audit corrections preserve historical readiness/resource boundaries. No native0.25.2 rebuild is claimed.

NAV-05 installed context acceptance (0.27.0): actual Chrome/Edge AX Cancel during a worker-paused pending Refresh stays closed after worker resume, and later explicit Continue recovers a fresh preview. Final-source and immutable native25.1 evidence is under docs/evidence/nav-adapters; live inputs and other platform claims remain pending.

NAV-05 Firefox local negatives (0.27.1): actual Firefox158 keyboard controls passed disabled-adapter generic preview and changed-layout refusal. Read-only production UI snapshots and inspected screenshots accompany exact driver/source/native25.1 hashes in docs/evidence/nav-adapters. Private-addon, ESR, other OS and live-host rows remain pending.

NAV-05 fixture review (0.27.2): future Firefox runs require full rendered UI state, actual regular profile/store identity and native destination/partial absence. Historical accepted rows retain their original driver fingerprints and inspected evidence.

NAV-04 Retry-After ingestion (0.26.0) adds exact request/document/session binding, durable server deadlines and resolver prepare/commit gates. Unit regressions and the owned-navigation loopback driver are implemented; installed browser and initial pre-claim response qualification remain pending.
