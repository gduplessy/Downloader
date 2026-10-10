# Development acceptance evidence

Recorded locally on Windows x64, 2026-10-10. This records a working preview, not the public release gate.

## Automated checks

- Rust: 6 unit tests, 8 network/recovery integration tests and 1 native framing test pass.
- Transfer fixtures cover segmented output hashes, ignored ranges, unknown length, redirects, pause/restart, changed validators, checksum refusal, interrupted finalization, rolling quotas, navigation claims and server filename recovery.
- Browser policy/handoff tests: 11 pass. Desktop utility/translation-key tests: 4 pass. TypeScript checks pass.
- Rust formatting and Clippy with warnings denied pass for core, service and CLI.
- Windows Tauri executable and NSIS installer build. Cross-platform CI is configured; remote CI has not run.

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
- Chrome stable, Edge, Firefox/ESR, macOS and Linux acceptance remain pending. Chrome for Testing evidence does not establish those matrix rows.
- Profile claims prevent competing navigation workers. Comprehensive private/container/partitioned session isolation and worker-restart tests remain release work.
- Deterministic media assembly, rendered/authenticated grabber, offline rewriting, advanced scheduling/synchronization and desktop completion integrations are unfinished.
- Media tools are currently installed separately through the verified component script; the preview installer does not bundle them.
- Installer execution, upgrade/uninstall, signing, updates, SBOM, corresponding bundled-source publication and store submissions are pending.

The detailed remaining implementation scope is in IMPLEMENTATION.md.
