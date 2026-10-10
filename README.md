# Downloader

An original GPL-3.0 download manager: Rust/libcurl engine, Tauri desktop UI, Chrome/Edge/Firefox extension sources. All operation stays local.

**Development preview; full IDM parity is not complete.** See [implementation status](docs/IMPLEMENTATION.md) and [compatibility](docs/COMPATIBILITY.md).

## Build

Install Rust 1.93.1, Node 22+, pnpm 10 and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install --frozen-lockfile
cargo build -p downloader-service -p downloader-cli
node scripts/prepare-sidecar.mjs --debug
pnpm --filter @downloader/desktop exec tauri dev
```

For an installer, use `cargo build --release`, prepare the sidecar without `--debug`, then `pnpm --filter @downloader/desktop exec tauri build`. Binaries live in `target/debug` or `target/release`; append `.exe` on Windows. Set `DOWNLOADER_DATA_DIR` to isolate testing.

## Browser extension

```sh
pnpm --filter @downloader/extension build
downloader register --chrome-id EXTENSION_ID
```

Read the generated ID from `apps/extension/dist/extension-id.txt`. Load `apps/extension/dist/chromium` unpacked in Chrome/Edge; load the Firefox manifest temporarily in Firefox. Permanent Firefox distribution requires Mozilla signing.

Enable integration in extension options. Capture starts disabled. The browser download is paused and cancelled only after a durable job and a viable desktop transfer. Failed handoffs resume browser handling.

Site access is granted for one site by default. Enabling all websites is an explicit optional choice. Navigation jobs have an exclusive browser-profile claim; choosing Continue in another profile transfers the claim.

### Hosted pages

Enable **Navigate download page** in the desktop Add dialog or use that extension context menu. A dedicated browser tab follows recognizable free-download controls, respects countdowns, and stops for CAPTCHA, login or ambiguity. Use **Continue page navigation** after manual steps. Cookies and relevant headers are temporary. POST/blob downloads remain browser-owned.

This is a bounded heuristic, not universal website automation. No premium access, CAPTCHA, waiting period or DRM bypass is implemented.

## Media components

The Windows component lock pins official yt-dlp, FFmpeg/ffprobe and Deno assets by SHA-256. Standalone yt-dlp includes matching EJS; no external Python installation is needed.

```sh
node scripts/components.mjs install /absolute/components/directory
```

Set that path in **Media components**. Explicit lock updates retain the previous bundle for rollback. Cross-platform component qualification and full source distribution remain release gates; see [third-party components](docs/THIRD_PARTY.md).

## CLI

```sh
downloader add https://example.com/file.zip --directory /absolute/download/path
downloader add https://example.com/file.zip --sha256 EXPECTED_SHA256
downloader add https://example.com/download-page --navigate
downloader --json diagnostics
downloader list
downloader pause JOB_ID
downloader resume JOB_ID
downloader resume JOB_ID --restart
downloader media https://example.com/video
downloader export downloads.json
downloader import downloads.json
downloader quit
```

Restart discards partial bytes explicitly. Embedded URL credentials are rejected; saved credentials use the OS keyring. The engine uses a private named pipe/Unix socket, with no public HTTP control server.

## Tests

```sh
cargo test -p downloader-core -p downloader-service -p downloader-cli
pnpm typecheck
pnpm test
pnpm build
node scripts/fixture-server.mjs
```

The loopback fixture exposes hosted/countdown/session, CAPTCHA, POST and direct/range/unknown-length scenarios. It is a test utility, not the application control interface.

Copyright © 2026 Downloader contributors. **GPL-3.0-only**, without warranty; see [LICENSE](LICENSE). External components retain their licenses. IDM branding, implementation, copy and assets are not included.
