# Development acceptance evidence

Recorded locally on Windows x64 and in platform CI, 2026-10-10/11. This records a working preview, not the public release gate. Product versions and README/roadmap state are synchronized by the version check.

## Automated checks

- Rust locally: 19 core units, 15 transfer/recovery integration tests and 3 service units pass (37 total). Four ignored subprocess helpers are invoked by their parent tests. Unix runners use a path-alias regression instead of the Windows locked-file regression, plus a native endpoint permission/rebind check.
- Transfer fixtures cover segmented hashes, strict headers/ranges, HEAD fallback, unknown/empty/compressed/truncated output, redirects, Retry-After, pause/restart, changed/missing validators, source expiry/authentication, checksum refusal, rolling quotas and server filenames. Ten actual subprocess abort boundaries and write/flush failures verify durable recovery without false completion.
- Extension policy/handoff tests: 12 pass. Desktop event/utility/translation-key tests: 6 pass (18 total). TypeScript checks and both client builds pass.
- Rust formatting and Clippy with warnings denied pass for core, service and CLI.
- Windows Tauri executable and NSIS installer were built for the initial preview. Current native desktop source compilation passes; installer execution is a separate pending gate.
- [Corrected CI](https://github.com/gduplessy/Downloader/actions/runs/38102100627) passed Rust, 38 protocol/performance cases, clients and desktop compilation on Windows, macOS Apple Silicon and Ubuntu. Earlier fixture response accounting failed and was repaired.
- [Initial large-file CI](https://github.com/gduplessy/Downloader/actions/runs/38102452983) verified actual 4,311,744,529-byte pause/reopen/resume/hash/publication on all three platforms, plus 38 protocol/performance cases including ZIP64 offsets. Its macOS CLI startup step failed. The [repair run](https://github.com/gduplessy/Downloader/actions/runs/38103251279) has passed macOS endpoint permissions, rebind and real CLI restart; final job status and the newer native response fixture are recorded separately.
- Real isolated CLI/service IPC locally verifies snapshot-first events, increasing cursors, pause/resume, output SHA-256 and completed-state persistence after service restart. Linux CI also passed it.
- Patch 0.2.2 adds a real native-messaging subprocess fixture for browser-safe creation responses, request correlation and durable duplicate creation; its cross-platform CI confirmation is pending.
- [Published transfer evidence](TRANSFER_ENGINE.md) includes platform curl capabilities, raw JSON, CPU/RSS/checkpoint/finalization timings and the unsuccessful IDM attempt. No IDM comparison result is claimed.

## Actual browser and native evidence

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

- The screenshot's specific host and changing live websites have not been qualified.
- Ordinary automatic interception needs further real-browser coverage. Hosted GET forms can provide explicit replay context when request observation is unavailable.
- Chrome stable, Edge, Firefox/ESR and macOS/Linux native GUI/browser/installer acceptance remain pending. Deterministic engine CI and Chrome for Testing evidence do not establish those matrix rows. Intel macOS is not the Apple Silicon CI runner.
- External NTLM/Kerberos realms, managed system/PAC/WPAD routing and actual disk-full/permission/cross-volume matrices remain qualification work. Capability flags and injected I/O failures do not establish them.
- Profile claims prevent competing navigation workers. Comprehensive private/container/partitioned session isolation and worker-restart tests remain release work.
- Deterministic media assembly, rendered/authenticated grabber, offline rewriting, advanced scheduling/synchronization and desktop completion integrations are unfinished.
- Media tools are currently installed separately through the verified component script; the preview installer does not bundle them.
- Installer execution, upgrade/uninstall, signing, updates, SBOM, corresponding bundled-source publication and store submissions are pending.

The detailed remaining implementation scope is in [ROADMAP.md](ROADMAP.md); [IMPLEMENTATION.md](IMPLEMENTATION.md) summarizes current behavior. Research backlog entries, including CAPTCHA automation/bypass, are not completed acceptance evidence.
