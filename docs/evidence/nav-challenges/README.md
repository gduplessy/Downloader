# Challenge qualification

Base: coordinator d6354c2. Live g4u, ddownload, Rapidgator and Gofile rows remain pending. Paid budget is $0; tests inject a mock transport and never upload a challenge.

The local solver supports a qualified dark open-circle image contract. It uses connected components, radial consistency and one bounded gap; multiple targets, edge components and unsupported variants abstain. An explicit user action is required. Synthetic images are generated in memory; no challenge payload is retained.

The held-out partition uses seeds 1000–1119 (120 images), distinct from development examples 0–19. Each image includes a closed-circle decoy. Tests require accepted-click accuracy >=99%, non-abstention >=80%, and p95 <=2 seconds. Scale/DPR mapping and clipping tests are separate. These tests establish synthetic geometry capability, not live host success.

Provider integration is service-owned and disabled by default. A fixed HTTPS endpoint, OS keyring reference, separate upload consent and nonzero spend ceiling are required. Reservations persist before a potentially billable call. Timeout/ambiguous create failures retain exposure across restart and duplicate bindings cannot create another paid task. Cancelled late results account their charge without exposing coordinates. No images, instructions, API keys or page secrets persist in the ledger.

Run: pnpm --filter @downloader/extension test -- geometry; cargo test -p downloader-core captcha::.

Browser/native end-to-end challenge submission, selected-host link extraction, downstream intended hash, visible desktop/extension controls, and remaining FlareSolverr lifecycle qualification are in progress. Do not treat module tests as these acceptance rows.
