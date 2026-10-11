# Changelog

Product versions follow [0.MINOR.PATCH](CONTRIBUTING.md#versioning). Major stays at 0 until the IDM parity release gate is satisfied.

## 0.2.1 — Routing and hostile-response regressions

- Match Windows manual proxy bypass host wildcards and `<local>` consistently, including case-insensitive matching and whole-host boundaries.
- Verify actual malformed range responses fall back without corrupting output, and encoded Unicode server filenames remain portable.
- Keep README, roadmap and package versions synchronized; enterprise proxy policy qualification remains open.

## 0.2.0 — Transfer engine and control contract

- Validate range responses and remote revisions; recover durable checkpoints, interrupted verification, and no-overwrite publication without false completion.
- Reuse isolated libcurl connections with host/global limits and concurrency backoff. Add HTTP/2, FTP/FTPS, routing/authentication/TLS controls and capability diagnostics.
- Add typed failures, browser-owned source refresh, sequenced events, reconnect snapshots, durable request receipts, and CLI progress watching.
- Add protocol/proxy fixtures, ten actual crash boundaries, storage-failure regressions, real CLI/service acceptance, ZIP64 offsets and transfers above 4 GiB.
- Publish reproducible performance measurements and remaining qualification gates. IDM comparison remains pending because the installed executable produced no fixture download.
- Synchronize desktop, CLI, service, extension and documentation versions; check drift in CI. Use pathname permissions for macOS IPC because Darwin does not support socket-descriptor chmod.

## 0.1.0 — Initial development preview

- Original GPL-3.0 desktop, CLI and extension foundation, hosted-page navigation fixtures, media/grabber adapters and public roadmap.
