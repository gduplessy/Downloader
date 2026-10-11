# Challenge qualification

Base: coordinator d6354c2. Live g4u, ddownload, Rapidgator and Gofile rows remain pending. Paid budget is $0; tests inject a mock transport and never upload a challenge.

The local solver supports a qualified dark open-circle image contract. It uses connected components, radial consistency and one bounded gap. Multiple targets, edge components and unsupported variants abstain. An explicit user action is required. Synthetic images are generated in memory; challenge payloads are not retained.

The held-out partition uses seeds 1000–1119, distinct from development examples 0–19. The 120 held-out images have 120 distinct pixel hashes and variable subpixel centers/radii. Each includes a closed-circle decoy. The solver was unchanged when the unique corpus expanded. Separate cases cover ambiguous/blank images, coordinate scale and DPR, clipping, cancellation, source/claim changes, CSRF, expiry and selected-host changes. These tests establish synthetic geometry capability. Unknown live variants and real-image occlusion remain unqualified.

Provider integration is service-owned and disabled by default. A fixed HTTPS endpoint, OS keyring reference, separate upload consent and nonzero spend ceiling are required. Reservations persist before a potentially billable call. Timeout or ambiguous creation retains exposure across restart. Duplicate bindings cannot create another paid task. Cancelled late results account their charge without exposing coordinates.

Service reconciliation resumes durable task IDs after worker or daemon restart. Numeric coordinates are bound metadata and can replay only under current source/claim ownership. Source/claim changes discard cached answers. Images, instructions, cookies, CSRF, page HTML and API keys stay transient. Unknown creation charges retain their reservation until provider accounting can be reconciled; restart never resets the spending ceiling.

## Recorded Windows evidence

- [Corpus](corpus-windows-x64.json): 120/120 accepted and correct, zero abstentions, zero accepted negatives across 80 negative images. p50 0.405 ms and p95 7.323 ms on Intel i7-5820K, Node 22.18.0, Windows 10.0.26100 x64.
- [Fresh-link desktop](fresh-link-desktop-windows-x64.json): HeadlessChrome 145.0.7632.6, production page module with mocked worker authorization. Each of the four synthetic provider pages submitted once, produced fresh links for gofile.io, and completed a separate real CLI desktop transfer of 253,952 bytes with SHA256 3956ab3c089f6def510fd6fafb24e11c5a6a0ddc8a521c99994746ee3756bc51.
- Six native provider mock tests and seven existing FlareSolverr native lifecycle fixtures passed. Solver cases cover disable, cancellation, changed page, cleanup failure, restart, secret nonpersistence, and final hash.

Installed worker/native-port challenge acceptance, visible production desktop/extension controls, true browser-challenge clearance, live host/account acceptance, and paid-provider acceptance remain pending. The DOM harness plus separate CLI transfer does not close the installed navigation path.

## Reproduce

1. Run node scripts/nav-fixtures/challenges/corpus.mjs.
2. Run node scripts/nav-fixtures/challenges/build.mjs.
3. Keep node scripts/nav-fixtures/challenges/server.mjs running.
4. Through gstack browse, navigate to the printed loopback base and evaluate window.runChallenges(). Save returned JSON to .local/nav-challenges/dom-result.json.
5. Run node scripts/nav-fixtures/challenges/desktop.mjs while the same fixture server remains running.

Run focused tests with pnpm --filter @downloader/extension test -- challenges and cargo test -p downloader-core captcha::.
