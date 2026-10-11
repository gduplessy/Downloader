# Third-party components

This is a source/build map and release checklist. It does not replace complete notices and corresponding source distribution.

| Component        | Purpose                                  | Source                                                                          |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| libcurl/curl-sys | Networking, TLS, proxies, authentication | https://github.com/curl/curl                                                    |
| libproxy | Linux system proxy/PAC discovery | https://github.com/libproxy/libproxy |
| pacparser | Linux explicit PAC execution (LGPL-3.0-or-later) | https://github.com/manugarg/pacparser |
| SQLite/rusqlite  | Persistence                              | https://sqlite.org/src ; https://github.com/rusqlite/rusqlite                   |
| Tauri/React      | Desktop shell/UI                         | https://github.com/tauri-apps/tauri ; https://github.com/facebook/react         |
| yt-dlp           | Media extraction                         | Locked release at https://github.com/yt-dlp/yt-dlp                              |
| yt-dlp EJS       | Supported media JavaScript challenges    | Matching standalone release; https://github.com/yt-dlp/ejs                      |
| FFmpeg/ffprobe   | Media assembly                           | https://github.com/yt-dlp/FFmpeg-Builds ; https://github.com/BtbN/FFmpeg-Builds |
| Deno             | Bundled JavaScript runtime               | Locked release at https://github.com/denoland/deno                              |
| FlareSolverr | Optional separately installed local browser service (MIT) | [3.4.6 source](https://github.com/FlareSolverr/FlareSolverr/tree/v3.4.6), [license](https://github.com/FlareSolverr/FlareSolverr/blob/v3.4.6/LICENSE) |

Use the exact yt-dlp release's build instructions, dependency locks and EJS version. Preserve PyInstaller module notices/source as required.

FlareSolverr is not bundled in Downloader. The [Compose file](../docker-compose.flaresolverr.yml) pins the separately qualified Linux amd64 container by digest; it contains Chromium and upstream runtime dependencies. Retain upstream notices and image provenance when redistributing it. [Qualification](FLARESOLVERR_QUALIFICATION.md) covers the exact image and limits. 2Captcha is a researched external-service candidate only; no SDK, credentials or paid integration are included.

The FFmpeg asset is a GPL build. Archive the matching FFmpeg and build-script commits, configure flags, patches, dependent libraries, licenses and source inputs. The mutable upstream latest URL is pinned by content SHA-256; changed content fails installation. Immutable corresponding-source archives are still required before public binary distribution.

Build Deno from the locked version with its embedded notices. macOS FFmpeg needs an independently qualified source build; the installer refuses Linux binaries on macOS.

Before release, generate Rust/JavaScript SBOMs from lockfiles; publish exact component source/build inputs, notices and checksums alongside installers.

Bundling, immutable provenance, notices/source distribution, SBOMs, and verified update work are tracked in [ROADMAP.md](ROADMAP.md#8-platform-qualification-packaging-and-release).

## Transfer build qualification

The workspace enables curl's `http2`, `protocol-ftp` and `ntlm` features. `.cargo/config.toml` defines `CURL_ENABLE_NTLM` for bundled libcurl 8.22, whose NTLM source compilation requires the macro in addition to the Rust feature. An externally supplied `CFLAGS` takes precedence; diagnostics report actual linked capabilities. System libcurl builds retain their distribution's protocol/authentication features.

Windows uses WinHTTP for system/PAC routing; macOS uses CFNetwork. Linux dynamically loads the installed libproxy/pacparser ABI. Preserve their source/notices when bundling them in an AppImage; system DEB dependencies do not replace the binary-release provenance gate.
