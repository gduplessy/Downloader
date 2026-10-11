# Development acceptance evidence

Recorded locally on Windows x64 and in platform CI, 2026-10-10/11. This records a working preview, not the public release gate. Product versions and README/roadmap state are synchronized by the version check.

## Automated checks

- The [0.3.1 follow-up CI](https://github.com/gduplessy/Downloader/actions/runs/38108335654) passes 40 Windows / 41 Unix Rust regressions and 44 Windows / 43 Unix network/performance cases. PAC checks assert observed proxy traversal, ordered failover, explicit direct fallback, exhausted routes, TLS/407 rejection and Windows implicit-bypass refusal. Earlier 0.2.x PAC fixtures matched file hashes without checking traversal, so those results alone do not establish PAC routing acceptance.
- The [0.3.2 filesystem CI](https://github.com/gduplessy/Downloader/actions/runs/38108936320) passes every job and real disk-full/restart, readonly-file refusal/recovery and cross-volume publication/collision preservation on NTFS, HFS+ and ext4 images. The Windows fixture's default-stack overflow was repaired with a heap buffer; no engine acceptance is inferred from the failed earlier attempt.
- The disposable Samba AD realm passes 13 local checks: nine Linux NTLM/Kerberos and four native Windows NTLM checks. Full jobs publish the expected 1,028,096-byte hash; rejected passwords and absent tickets produce authentication recovery with no output file. Kerberos-only Apache disables Basic/NTLM fallback. The fixture uses volatile credential injection; OS keyring acceptance is separate. [Reproduction and scope](AUTH_REALM.md).

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

- Filesystem qualification covers the documented NTFS/HFS+/ext4 image matrix. Local Windows image formatting was not attempted without administrator rights; disposable CI runners performed the accepted Windows test.

- The screenshot's specific host and changing live websites have not been qualified.
- Ordinary automatic interception needs further real-browser coverage. Hosted GET forms can provide explicit replay context when request observation is unavailable.
- Chrome stable, Edge, Firefox/ESR and macOS/Linux native GUI/browser/installer acceptance remain pending. Deterministic engine CI and Chrome for Testing evidence do not establish those matrix rows. Intel macOS is not the Apple Silicon CI runner.
- Native macOS authentication, Windows domain-based Kerberos, proxy SSO, managed system/PAC/WPAD routing and final installer provenance remain qualification work. Docker Linux authentication and native Windows NTLM results do not establish those separate rows.
- Profile claims prevent competing navigation workers. Comprehensive private/container/partitioned session isolation and worker-restart tests remain release work.
- Deterministic media assembly, rendered/authenticated grabber, offline rewriting, advanced scheduling/synchronization and desktop completion integrations are unfinished.
- Media tools are currently installed separately through the verified component script; the preview installer does not bundle them.
- Installer execution, upgrade/uninstall, signing, updates, SBOM, corresponding bundled-source publication and store submissions are pending.

The detailed remaining implementation scope is in [ROADMAP.md](ROADMAP.md); [IMPLEMENTATION.md](IMPLEMENTATION.md) summarizes current behavior. Research backlog entries, including CAPTCHA automation/bypass, are not completed acceptance evidence.
