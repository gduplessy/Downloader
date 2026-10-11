# Implementation status

The accepted five-increment plan remains the scope. A development build does not establish complete parity or platform acceptance.

The [complete roadmap](ROADMAP.md) tracks all documented limitations, including hosted-page challenges, CAPTCHA automation/bypass research, unsupported transfer paths, later platforms, and intentional product controls. Research and later items expand the backlog without becoming initial-release commitments.

## Implemented preview

- Rust/libcurl engine, SQLite WAL, CLI and restricted native bridge.
- HTTP/HTTPS, HTTP/2, FTP/FTPS including FTP restart, strict range/body/validator checks, compression/empty streams, GET redirects, bounded Retry-After retries and conservative serial fallback.
- Session/routing-isolated connection reuse, global/host limits and host concurrency backoff. TLS verification stays enabled; system/direct/manual/PAC routing with bounded ordered failover, CA files and available Basic/Digest/NTLM/Negotiate policies are configurable.
- Durable validated offsets, typed failures/recovery, verified SHA-256, no-overwrite publication, recoverable destination staging, and supervised scanner processes. Pause/cancel and failed writes/flushes cannot publish uncommitted offsets.
- Real files above 4 GiB and remote ZIP64 offsets; ten subprocess termination boundaries cover checkpointing, verification, publication, scanning and staged copies.
- Versioned negotiation, SQLite-backed sequenced events/replay, snapshot-first reconnect, transactional request idempotency/tombstones, browser-safe projections and CLI watch. Browser source refresh requires the owning profile.
- Desktop table/search/filter/progress/segment detail; add/bulk templates, categories, queue settings, source refresh, import/export, clipboard opt-in and tray close.
- Extension popup/options/context menus, automatic GET handoff, session context, exclusions, bypass and browser fallback.
- Hosted-page resolver: dedicated tab, countdowns, bounded free-download steps, manual challenge states, browser ownership for POST/blob requests.
- Durable exclusive browser-profile claims and explicit GET link/form capture; ordinary and partitioned session cookie selection.
- Active-transfer rolling quotas with exact durable-byte limits and verified hash-correct recovery after the limit is lifted.
- yt-dlp/media selection adapter and checksum-verified Windows FFmpeg/Deno/yt-dlp component installation.
- Static crawl/filter/selection backend and remote ZIP/ZIP64 metadata reader.
- Shared six-language UI dictionaries, RTL direction and themes.

## Required implementation and acceptance work

- External NTLM/Negotiate authentication-realm acceptance, native proxy-policy/PAC failure matrices, and actual disk-full/permission/cross-volume filesystem acceptance. Deterministic write/flush, collision, path, lock/alias and recovery regressions are implemented.
- DST/missed-window scheduling and reliable synchronization; media quota accounting needs qualification.
- Editable job properties/columns/drop target; notifications, sleep inhibition, autostart and explicit completion actions.
- Authenticated/rendered crawler sessions, durable crawl frontier, scheduled synchronization, CSS discovery and offline HTML/CSS rewriting.
- Deterministic media assembly/HLS/DASH/playlist/subtitle/live tests, subprocess tree recovery and full credential scoping.
- Actual-browser acceptance on each supported platform, worker restarts, partitioned/container cookies, native-host loss and fallback.
- Cross-platform component bundles, immutable source/build provenance, complete GPL source distribution, SBOM and update qualification.
- Native translation review, backend/default-category localization, accessibility, installer upgrade/uninstall and visible native workflow acceptance.
- Signed updates, release identifiers and signing/store accounts. IDM comparison tooling exists, but the installed IDM executable produced no fixture output in two attempts; comparative results remain pending.

Recorded evidence belongs in docs/ACCEPTANCE.md. Source implementation, automated fixture tests and live platform acceptance are separate.

Transfer-engine implementation, reproducible commands, measurements and qualification boundaries are recorded in [TRANSFER_ENGINE.md](TRANSFER_ENGINE.md).
