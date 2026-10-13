# Challenge qualification

Base: checked coordinator c8ac54d with challenge increment 0.10.9. Live g4u, ddownload, Rapidgator and Gofile rows remain pending. Paid budget is $0; tests inject a mock transport and never upload a challenge.

The local solver supports a qualified dark open-circle image contract. It uses connected components, radial consistency and one bounded gap. Multiple targets, edge components and unsupported variants abstain. An explicit user action is required. Synthetic images are generated in memory; challenge payloads are not retained.

The held-out partition uses seeds 1000–1119, distinct from development examples 0–19. The 120 held-out images have 120 distinct pixel hashes and variable subpixel centers/radii. Each includes a closed-circle decoy. The solver was unchanged when the unique corpus expanded. Separate cases cover ambiguous/blank images, coordinate scale and DPR, clipping, cancellation, source/claim changes, CSRF, expiry and selected-host changes. These tests establish synthetic geometry capability. Unknown live variants and real-image occlusion remain unqualified.

Provider integration is service-owned and disabled by default. A fixed HTTPS endpoint, OS keyring reference, separate upload consent and nonzero spend ceiling are required. Reservations persist before a potentially billable call. Timeout or ambiguous creation retains exposure across restart. Duplicate bindings cannot create another paid task. Cancelled late results account their charge without exposing coordinates.

Service reconciliation resumes durable task IDs after worker or daemon restart. Numeric coordinates are bound metadata and can replay only under current source/claim ownership. Source/claim changes discard cached answers. Images, instructions, cookies, CSRF, page HTML and API keys stay transient. Unknown creation charges retain their reservation until provider accounting can be reconciled; restart never resets the spending ceiling.

## Recorded Windows evidence

- [Corpus](corpus-windows-x64.json): 120/120 accepted and correct, zero abstentions, zero accepted negatives across 80 negative images. p50 0.405 ms and p95 7.323 ms on Intel i7-5820K, Node 22.18.0, Windows 10.0.26100 x64.
- [Fresh-link desktop](fresh-link-desktop-windows-x64.json): HeadlessChrome 145.0.7632.6, production page module with mocked worker authorization. Each of the four synthetic provider pages submitted once, produced fresh links for gofile.io, and completed a separate real CLI desktop transfer of 253,952 bytes with SHA256 3956ab3c089f6def510fd6fafb24e11c5a6a0ddc8a521c99994746ee3756bc51.
- Six native provider mock tests and seven existing FlareSolverr native lifecycle fixtures passed. Solver cases cover disable, cancellation, changed page, cleanup failure, restart, secret nonpersistence, and final hash.

- [Installed Chrome](installed-chrome-windows-x64.json): stable Chrome 155.0.8059.39 runs the production worker/resolver and native stream port against four local provider pages. Four original CAPTCHA POSTs return fresh gofile.io links; each completes a 253,952-byte desktop file matching SHA256 3956ab3c089f6def510fd6fafb24e11c5a6a0ddc8a521c99994746ee3756bc51. Original page provenance and selected-host metadata are asserted. Native service 0.10.9 and its binary hash are recorded. Diagnostic source tracing is disabled, and paid calls are zero.
- The installed driver resumes the fresh HTML page through the trusted extension Continue action. Its final actual preview element click is scheduled after the page CDP driver detaches, preserving exclusive production chrome.debugger ownership. File bytes travel through the production native port, never the driver. Automatic fresh-page preview without explicit Continue remains outside this qualification.

Visible native desktop-window acceptance, true browser-challenge clearance, live host/account acceptance, paid-provider acceptance, installed Firefox/Edge challenge flows and unavailable OS rows remain pending. The earlier DOM/CLI report remains separate evidence.

- [Production solver controls](solver-controls-windows-x64.json): actual React controls backed by an isolated native CLI/service. Enable/save, fake-local-health test, stale-setting invalidation, disable/save and daemon restart pass. A fake readiness result is not challenge clearance.
- [Twelve stale DOM cases](stale-dom-windows-x64.json) produce zero submissions: cancellation, CSRF, hidden host, form action, image replacement, expiry, claim, source, document nonce, session, occlusion and cancelled host choice. This real-renderer harness uses mocked worker authorization; installed invalidation scenarios remain separate gates.
- Official [CoordinatesTask documentation](https://2captcha.com/api-docs/coordinates) rechecked through gstack on 2026-10-11 confirms image limits, create/poll, click bounds and cost fields. No live API request was made.

## Reproduce

1. Run node scripts/nav-fixtures/challenges/corpus.mjs.
2. Run node scripts/nav-fixtures/challenges/build.mjs.
3. Keep node scripts/nav-fixtures/challenges/server.mjs running.
4. Through gstack browse, navigate to the printed loopback base and evaluate window.runChallenges(). Save returned JSON to .local/nav-challenges/dom-result.json.
5. Run node scripts/nav-fixtures/challenges/desktop.mjs while the same fixture server remains running.

For production settings, keep node scripts/nav-fixtures/challenges/controls-server.mjs running, navigate through gstack to its printed loopback URL and evaluate window.runSolverControls().

Run focused tests with pnpm --filter @downloader/extension test -- challenges and cargo test -p downloader-core captcha::.


For the installed path, build the CLI/service and run node scripts/nav-fixtures/challenges/installed.mjs. It creates isolated native registration, profile, state, ports and destinations, then removes its own registration and stops its own processes. The fixture grants only loopback host access and substitutes extension/native host identities. Keep the page driver detached during production debugger byte capture.

Checks for 0.10.9: 121 extension tests, 6 desktop tests, both client typechecks/builds, 113 native tests (4 ignored subprocess helper entrypoints), Rustfmt, strict Clippy, desktop Rust compilation and synchronized version artifacts passed. Six provider mocks and seven FlareSolverr lifecycle cases are included in the native suite.
