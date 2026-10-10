# Third-party components

This is a source/build map and release checklist. It does not replace complete notices and corresponding source distribution.

| Component | Purpose | Source |
|---|---|---|
| libcurl/curl-sys | Networking, TLS, proxies, authentication | https://github.com/curl/curl |
| SQLite/rusqlite | Persistence | https://sqlite.org/src ; https://github.com/rusqlite/rusqlite |
| Tauri/React | Desktop shell/UI | https://github.com/tauri-apps/tauri ; https://github.com/facebook/react |
| yt-dlp | Media extraction | Locked release at https://github.com/yt-dlp/yt-dlp |
| yt-dlp EJS | Supported media JavaScript challenges | Matching standalone release; https://github.com/yt-dlp/ejs |
| FFmpeg/ffprobe | Media assembly | https://github.com/yt-dlp/FFmpeg-Builds ; https://github.com/BtbN/FFmpeg-Builds |
| Deno | Bundled JavaScript runtime | Locked release at https://github.com/denoland/deno |

Use the exact yt-dlp release's build instructions, dependency locks and EJS version. Preserve PyInstaller module notices/source as required.

The FFmpeg asset is a GPL build. Archive the matching FFmpeg and build-script commits, configure flags, patches, dependent libraries, licenses and source inputs. The mutable upstream latest URL is pinned by content SHA-256; changed content fails installation. Immutable corresponding-source archives are still required before public binary distribution.

Build Deno from the locked version with its embedded notices. macOS FFmpeg needs an independently qualified source build; the installer refuses Linux binaries on macOS.

Before release, generate Rust/JavaScript SBOMs from lockfiles; publish exact component source/build inputs, notices and checksums alongside installers.
