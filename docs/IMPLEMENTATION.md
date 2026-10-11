# Implementation status

The accepted five-increment plan remains the scope. A development build does not establish complete parity or platform acceptance.

The [complete roadmap](ROADMAP.md) tracks all documented limitations, including hosted-page challenges, CAPTCHA automation/bypass research, unsupported transfer paths, later platforms, and intentional product controls. Research and later items expand the backlog without becoming initial-release commitments.

## Implemented preview

- Rust/libcurl engine, SQLite WAL, CLI and restricted native bridge.
- Actual range validation, dynamic segmentation, serial fallback, durable checkpoints, validator-based resume, checksum rejection and recoverable finalization.
- Desktop table/search/filter/progress/segment detail; add/bulk templates, categories, queue settings, source refresh, import/export, clipboard opt-in and tray close.
- Extension popup/options/context menus, automatic GET handoff, session context, exclusions, bypass and browser fallback.
- Hosted-page resolver: dedicated tab, countdowns, bounded free-download steps, manual challenge states, browser ownership for POST/blob requests.
- Durable exclusive browser-profile claims and explicit GET link/form capture; ordinary and partitioned session cookie selection.
- Active-transfer rolling quotas with exact durable-byte limits and verified hash-correct recovery after the limit is lifted.
- yt-dlp/media selection adapter and checksum-verified Windows FFmpeg/Deno/yt-dlp component installation.
- Static crawl/filter/selection backend and remote ZIP/ZIP64 metadata reader.
- Shared six-language UI dictionaries, RTL direction and themes.

## Required implementation and acceptance work

- Broader transfer fixtures: redirects and credential leakage, authentication/proxy failures, >4 GB, malformed ranges, compression, empty streams, retries and hostile filesystem cases.
- Connection pooling across jobs, DST/missed-window scheduling and reliable synchronization; media quota accounting needs qualification.
- Editable job properties/columns/drop target; notifications, sleep inhibition, autostart and explicit completion actions.
- Authenticated/rendered crawler sessions, durable crawl frontier, scheduled synchronization, CSS discovery and offline HTML/CSS rewriting.
- Deterministic media assembly/HLS/DASH/playlist/subtitle/live tests, subprocess tree recovery and full credential scoping.
- Actual-browser acceptance on each supported platform, worker restarts, partitioned/container cookies, native-host loss and fallback.
- Cross-platform component bundles, immutable source/build provenance, complete GPL source distribution, SBOM and update qualification.
- Native translation review, backend/default-category localization, accessibility, installer upgrade/uninstall and visible native workflow acceptance.
- Signed updates, release identifiers, signing/store accounts and measured IDM comparisons.

Recorded evidence belongs in docs/ACCEPTANCE.md. Source implementation, automated fixture tests and live platform acceptance are separate.
