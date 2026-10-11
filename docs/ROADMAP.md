# Downloader roadmap

Current product version: <!-- product-version -->0.2.5<!-- /product-version -->. Major stays at `0` until the full IDM parity acceptance gate is satisfied; see [version policy](../CONTRIBUTING.md#versioning).

This roadmap tracks the limitations stated in the README, implementation status, compatibility matrix, acceptance evidence, and component notices. It explicitly includes currently unsupported capabilities, including **CAPTCHA automation / bypass**.

An unchecked item is unfinished. **Planned** means implementation work; **qualification** means evidence is missing even where code exists; **research** means feasibility and a supported approach must be established; **later** means outside the initial release matrix. Listing an item does not claim that it works today or promise universal website support.

The initial release still targets Windows 11 x64, macOS 14+ Intel and Apple Silicon, Ubuntu 24.04+ x64, and Chrome, Edge, Firefox stable, and Firefox ESR. Research and later-platform work can follow those release gates. No dates are promised before dependencies and acceptance requirements are understood.

## 1. Hosted download pages and challenges

| ID     | Unfinished or unsupported capability                                 | Next work and completion criteria                                                                                                                                                                                                                                                                                                                                                   | Status                  |
| :----- | :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------- |
| NAV-01 | **CAPTCHA automation / bypass**                                      | Research challenge-solving adapters and user-requested solver integrations for authorized download workflows. Evaluate local processing first; require opt-in before sending challenge/session material to an external service. Measure success, expiry, failure, and cost on an explicit host/challenge matrix; retain manual completion and explain unsupported challenges.       | Research                |
| NAV-02 | Sign-in steps currently need manual input                            | Add host-specific login detection, credential-store integration, authenticated-session refresh, and a clear browser handoff for MFA. Verify credential scoping, expiry, redirects, logout, and profile isolation.                                                                                                                                                                   | Planned                 |
| NAV-03 | Premium-access steps and premium-access bypass are unsupported       | Add downloads through accounts with existing premium entitlements, account/session selection, and provider-supported APIs. Track bypass feasibility separately: establish a provider-supported or explicitly authorized approach before committing an implementation. Payment or entitlement checks remain visible; listing this item does not promise free access to paid content. | Planned / research      |
| NAV-04 | Waiting periods require a live browser tab                           | Improve countdown discovery, background wait/recovery, retry timing, and readiness notifications after sleep or restart. Research supported instant-download mechanisms on qualified hosts; do not report a wait as complete while a server still requires it.                                                                                                                      | Planned / research      |
| NAV-05 | Ambiguous buttons stop automation                                    | Add versioned site adapters, confidence scoring, ad/premium/torrent control discrimination, and a user selection preview. Fixtures must prove that the chosen control initiates the intended file.                                                                                                                                                                                  | Planned                 |
| NAV-06 | Generic heuristics do not support every host or changing page layout | Publish a host compatibility matrix, regression fixtures, adapter contribution format, and live smoke tests. Include pages like the supplied screenshot in host qualification using permitted test files. Unsupported pages need a clear reason and a manual browser workflow.                                                                                                      | Planned / qualification |
| NAV-07 | Non-replayable POST requests remain browser-managed                  | Research safe browser-assisted transfer/import strategies that preserve method, body, tokens, and one-use semantics. Never retry a non-replayable submission as a guessed GET. Verify fallback completion and failure reporting.                                                                                                                                                    | Research                |
| NAV-08 | Browser-generated blobs cannot be replayed by the desktop            | Add browser-owned progress/completion tracking and explicit verified import/export where browser APIs allow it. Research a transfer path within the native-bridge permission model; do not assume a `blob:` URL is usable outside its page.                                                                                                                                         | Planned / research      |
| NAV-09 | One-use and session-bound requests may require browser ownership     | Detect replay risk before cancellation, preserve the browser transfer, and add provider-specific refresh/session recovery. Test token consumption, redirects, expired URLs, and transfer failure.                                                                                                                                                                                   | Planned / qualification |
| NAV-10 | Navigation is capped at three pages and one page per host            | Add configurable, host-aware navigation queues and transparent wait reasons. Preserve cookie/session integrity; qualify higher limits before allowing concurrent steps on the same host.                                                                                                                                                                                            | Planned                 |
| NAV-11 | Profile claims lack comprehensive privacy/container qualification    | Test private browsing, separate profiles, Firefox containers, partitioned cookies, competing workers, claim transfer, and extension-worker restart. Navigation context must never cross an unintended session boundary.                                                                                                                                                             | Qualification           |
| NAV-12 | Browser-driven rendered discovery is unfinished                      | Add extension-controlled discovery tabs, user-visible navigation state, and resume when a browser becomes available. Keep rendered discovery and final download handoff under the same session ownership rules.                                                                                                                                                                     | Planned                 |

## 2. Transfer engine, correctness, and networking

- [ ] **ENG-01 — Protocol qualification (implemented; partial qualification):** HTTP/HTTPS, HTTP/2, FTP REST resume, explicit/implicit FTPS, redirects and capability diagnostics pass deterministic fixtures on Windows/macOS/Linux. Remaining: external NTLM/Kerberos realms and final shipped libcurl/installer provenance.
- [x] **ENG-02 — Hostile response fixtures:** strict malformed/ignored range and header validation, HEAD fallback, unknown/empty/compressed streams, truncated bodies, unexpected full responses, Retry-After/throttling, changed/missing validators, expired/authenticated sources and portable Unicode filename coverage.
- [x] **ENG-03 — Large-file evidence:** actual 4,311,744,529-byte pause/reopen/resume/checkpoint/hash/publication passes on all three CI platforms; remote ZIP64 central-directory offsets above 4 GiB are verified.
- [x] **ENG-04 — Connection pooling:** bounded session/routing-isolated reuse, host/global admission and concurrency backoff; repeated single/segmented measurements include server caps and hashes.
- [x] **ENG-05 — Recovery fault injection:** ten actual subprocess termination boundaries cover partial creation, checkpoints, verification, assembly/publication, scanning and staged copies. Recovered output hashes match; no falsely completed jobs.
- [ ] **ENG-06 — Filesystem failures (implemented; partial qualification):** durable ownership/offsets, filename/path validation, collision and overwrite protection, write/flush injection, Windows locked files, Unix path aliases and recoverable staged copies are covered. Remaining: real disk-full/permission-denial/cross-volume acceptance matrices.
- [ ] **ENG-07 — Networking controls (implemented; partial qualification):** HTTP/HTTPS CONNECT, SOCKS4/5/5h, local platform PAC, Basic/Digest and redirect isolation fixtures pass. Desktop system/direct/manual/PAC/TLS/authentication settings and browser-routing guidance exist. Remaining: enterprise system/PAC/WPAD/bypass policies, ordered proxy failover and external NTLM/Negotiate realm acceptance.
- [x] **ENG-08 — Expired-source recovery:** typed authentication/expired/changed/resume failures with recovery actions, profile-owned browser refresh and explicit restart decisions; fixtures prevent incompatible byte merging. Stable-browser acceptance remains WEB work.
- [ ] **ENG-09 — Public control protocol (implemented; confirming qualification):** transactional typed/sequence events, snapshot-first reconnect/replay, negotiation, durable idempotency/tombstones, CLI watch and browser-safe projection are covered. macOS endpoint permissions/rebind and CLI restart now pass CI. The newer real native creation/privacy fixture awaits cross-platform CI confirmation. Native GUI/browser matrix remains separate WEB/REL work.
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
