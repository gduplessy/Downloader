# Development acceptance evidence

Recorded locally on Windows x64 and in platform CI, 2026-10-10/11. This records a working preview, not the public release gate. Product versions and README/roadmap state are synchronized by the version check.

## Automated checks

- The 0.3.0 follow-up adds two route-policy unit regressions (40 total Windows functional regressions; 41 expected on Unix). Strict local Clippy and six Windows PAC cases pass, including observed proxy traversal, ordered failover, exhausted routes, TLS/407 rejection and implicit-loopback-bypass refusal. All-platform follow-up qualification remains pending. Earlier 0.2.x PAC fixtures matched file hashes but did not assert proxy traversal, so those results alone do not establish PAC routing acceptance.

- The 0.2.x full-matrix evidence: 38 functional regressions on Windows (20 core, 15 transfer/recovery, 3 service); 39 on Unix with the additional native endpoint permission/rebind check. Four ignored subprocess helpers are invoked by their parent tests. Unix uses a path-alias regression instead of the Windows locked-file regression. Full-suite evidence and source revisions are linked below; targeted local checks also cover proxy maps, weak validators and repeated write/flush failures.
- Transfer fixtures cover segmented hashes, strict headers/ranges, HEAD fallback, unknown/empty/compressed/truncated output, redirects, Retry-After, pause/restart, changed/missing validators, source expiry/authentication, checksum refusal, rolling quotas and server filenames. Ten actual subprocess abort boundaries and write/flush failures verify durable recovery without false completion.
- Extension policy/handoff tests: 12 pass. Desktop event/utility/translation-key tests: 6 pass (18 total). TypeScript checks and both client builds pass.
- Rust formatting and Clippy with warnings denied pass for core, service and CLI.
- Windows Tauri executable and NSIS installer were built for the initial preview. Current native desktop source compilation passes; installer execution is a separate pending gate.
- [Final source CI](https://github.com/gduplessy/Downloader/actions/runs/38104393525) records the final response-validator patch; it runs Rust fixtures, strict Clippy/formatting, 38 protocol/performance cases, real native/CLI fixtures, clients and desktop compilation on Windows, macOS Apple Silicon and Ubuntu. Check the linked job status independently of native release acceptance.
- [Large-file CI](https://github.com/gduplessy/Downloader/actions/runs/38103251279) passed every job and verified actual 4,311,744,529-byte pause/reopen/resume/hash/publication on all three platforms, plus ZIP64 offsets and macOS endpoint permissions/rebind.
- [Native/control CI](https://github.com/gduplessy/Downloader/actions/runs/38104025817) passed its real native-messaging/CLI steps on all three platforms: browser-safe repeated creation, request correlation, snapshot-first sequenced events, pause/resume, output SHA-256 and completed-state persistence after service restart. Sanitized per-platform records are published with exact source revisions.
- A prior Windows storage fixture exposed sibling cancellation overwriting the primary failure. The cause was fixed; five consecutive local write/flush fixture repetitions passed. Earlier benchmark fixture accounting and macOS socket-descriptor permissions were also repaired; failed attempts are not counted as passing evidence.
- [Published transfer evidence](TRANSFER_ENGINE.md) includes platform curl capabilities, raw JSON, CPU/RSS/checkpoint/finalization timings and the unsuccessful IDM attempt. No IDM comparison result is claimed.

## Actual browser and native evidence

### FlareSolverr increment (0.5.3)

- Rust: 29 core units, 7 solver lifecycle integrations, 15 transfer/recovery integrations and 3 service units pass (54 unique tests; full suite plus the final cleanup regression and core/solver reruns); four subprocess helpers remain ignored entry points invoked by parent regressions. Fault injection is enabled. The new settings-event projection assertion verifies that only notification metadata reaches the browser.
- TypeScript: 14 extension and 6 desktop tests pass (20 total), including identical nonempty keys across all six locales. Type checks and client builds pass. Rust formatting, Clippy with warnings denied, CLI/service builds and Windows native desktop source compilation pass.
- Existing local FlareSolverr and a separately created pinned Docker deployment passed four valid generated 2 MiB rendered-GET/cookie, matching User-Agent, range pause/resume and SHA-256 transfers. Four CAPTCHA and four expiry fixture requests stopped with zero bytes. [Detailed stage evidence and timing](FLARESOLVERR_QUALIFICATION.md) distinguish readiness, rendering, source resolution and transfer completion.
- The isolated Compose deployment was healthy, loopback-bound and configured with HTML logging disabled. Native IPC regression passed creation projection/idempotency, snapshot-first sequencing, pause/resume and completed-state persistence after restart.
- Real Cloudflare clearance, actual g4u CAPTCHA submissions, fresh links, downstream hosts, new visible desktop settings interactions and cross-platform/browser acceptance remain unqualified. No paid CAPTCHA requests or external uploads were made.

### Earlier hosted-page preview

- Unpacked Chromium extension in an isolated Chrome for Testing profile; permissions granted only for 127.0.0.1, with no history or all-site grant.
- Hosted fixture: free download link, 3-second countdown, enabled final GET form, HttpOnly session cookie, temporary token and 12 MiB output.
- Desktop job 30c6b97e-b7b2-4387-9338-f3aea20a12eb completed with SHA-256 b6967a4c54cdab8a16907be0774af71e5db8198045f91933ebed106ddba22dfb. Browser download was paused and subsequently cancelled after viable desktop acceptance.
- CAPTCHA job 1161231a-435a-4100-829c-6acd620b8c4d stopped in waiting_user with zero bytes.
- POST job 46be17d6-03a1-43d5-8ba3-68a87fb5c39e finished as browser_complete with 12 MiB. The desktop did not replay the POST.
- Native executable rejects an unknown extension identity, privileged commands and control of unrelated desktop jobs; snapshots omit destinations/settings.
- Native window captured through PrintWindow: connected download table displayed the completed desktop file, browser completion and manual challenge state. Keyboard, screen-reader and complete settings workflows remain unqualified.
- Verified component installer downloaded SHA-256 pinned Windows yt-dlp, FFmpeg/ffprobe and Deno. yt-dlp inspection ran without a separate Python installation; full media acceptance remains pending.

Ignored local evidence is under .local/evidence. Fixture URLs and request/session tokens are not published as diagnostics.

## Limits and remaining qualification

- The 0.3.1 disposable filesystem harness compiles and has an opt-in three-platform CI workflow. Local Windows image formatting was not attempted without administrator rights; actual platform results are pending.

- The screenshot's specific host and changing live websites have not been qualified.
- Ordinary automatic interception needs further real-browser coverage. Hosted GET forms can provide explicit replay context when request observation is unavailable.
- Chrome stable, Edge, Firefox/ESR and macOS/Linux native GUI/browser/installer acceptance remain pending. Deterministic engine CI and Chrome for Testing evidence do not establish those matrix rows. Intel macOS is not the Apple Silicon CI runner.
- External NTLM/Kerberos realms, managed system/PAC/WPAD routing and actual disk-full/permission/cross-volume matrices remain qualification work. Capability flags and injected I/O failures do not establish them.
- Profile claims prevent competing navigation workers. Comprehensive private/container/partitioned session isolation and worker-restart tests remain release work.
- Deterministic media assembly, rendered/authenticated grabber, offline rewriting, advanced scheduling/synchronization and desktop completion integrations are unfinished.
- Media tools are currently installed separately through the verified component script; the preview installer does not bundle them.
- Installer execution, upgrade/uninstall, signing, updates, SBOM, corresponding bundled-source publication and store submissions are pending.

The detailed remaining implementation scope is in [ROADMAP.md](ROADMAP.md); [IMPLEMENTATION.md](IMPLEMENTATION.md) summarizes current behavior. Research backlog entries, including CAPTCHA automation/bypass, are not completed acceptance evidence.
