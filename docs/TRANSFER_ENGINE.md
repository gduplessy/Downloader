# Transfer engine: implementation and evidence

This increment covers ENG-01 through ENG-10. It implements the transfer/control workflows and publishes deterministic evidence; external authentication realms, some native filesystem policies and the IDM comparison remain qualification work. Product major stays at 0 until the full parity release gate is satisfied.

## Transfer and recovery rules

- HTTP/HTTPS, HTTP/2, FTP REST resume, explicit FTP TLS and implicit FTPS use libcurl. Diagnostics report the actual linked protocols, TLS backend and authentication capabilities.
- Range support is probed with an actual response. Strict Content-Range/Length and body bounds prevent a full response from being appended to partial output. Compression and unknown/empty streams use conservative serial paths; serial retries start over.
- Segmented/resumed transfers need a strong ETag or Last-Modified validator. Remote size and validators are checked before merging bytes. Changed or missing identity requires an explicit restart decision.
- Retry-After and bounded exponential backoff apply to transient failures. Defaults are three jobs, four connections per job, eight per host and five retries. Host rejection temporarily reduces concurrency. Authentication waits for corrected credentials.
- SQLite WAL checkpoints commit only after corresponding bytes are synced. Persisted topology, offsets and partial-file ownership are validated. Pause, cancel, write and flush failures cannot promote dirty progress to a checkpoint.
- Verification computes SHA-256 and enforces a supplied checksum. Publication uses no-overwrite linking or recoverable destination staging/copy/hash/rename. A verified interrupted publication can recover without contacting the source.
- Scanner execution is opt-in, without a shell, bounded to five minutes, cancellable and supervised with process groups/Windows Job Objects. Output is verified again after scanning. This is process supervision, not a sandbox for malicious scanner programs.
- Ten actual subprocess abort boundaries cover partial creation, both checkpoint boundaries, verification, publication, completion, scanning and both staged-copy boundaries. Fault injection is excluded from ordinary release builds.

## Routing and sessions

Reusable libcurl handles are bounded and keyed by origin, request context, routing settings and credential identity; authenticated connections cannot cross those keys. Connections expire after 60 idle seconds. TLS verification is always enabled; an explicit CA file can trust a private source or HTTPS proxy.

| Routing | Implementation | Qualification boundary |
| --- | --- | --- |
| Direct/manual | Explicit direct, HTTP/HTTPS CONNECT and SOCKS4/5/5h | Local fixtures on all three CI platforms |
| Windows system/PAC | Current-user WinHTTP configuration and PAC | Local PAC fixture; enterprise policy/WPAD/bypass matrices remain |
| macOS system/PAC | CFNetwork settings and bounded PAC callback | Local PAC fixture; managed policy and failover remain |
| Linux system/PAC | libproxy system resolution; serialized pacparser for explicit PAC | Runtime libraries required; local PAC fixture; desktop policy matrices remain |
| Authentication | OS keyring references, Basic/Digest and available NTLM/Negotiate | Basic/Digest challenge fixtures; NTLM/Kerberos external realms remain |

PAC adapters choose a supported proxy result; ordered multi-proxy failover is not yet qualified. PAC scripts are explicitly configured/trusted; downloading them is bounded, but Linux parser execution has no separate timeout. Missing Linux libproxy falls back to libcurl environment routing; explicit PAC requires libpacparser. DEB declares runtime libraries; AppImage packaging still needs acceptance.

Browser-only VPN/proxy extensions do not route the desktop engine. Configure desktop routing explicitly when necessary. Cross-origin redirects clear source cookies/authorization, and HTTPS downgrades are rejected. Browser source refresh requires the owning profile; replacement context is temporary and incompatible partial bytes are never merged.

## Public control protocol

Wire version **1** is independent of product versions. Restricted per-user named pipes/Unix sockets carry native-endian four-byte-length-prefixed JSON. Request size is bounded to 1 MiB; browser responses are also bounded to 1 MiB. No public HTTP control listener is used.

```json
{"version":1,"id":"client-request-1","command":"subscribe","args":{"after_sequence":null,"limit":100}}
```

- Responses contain matching `version`, `id`, `ok`, `data` and structured `error`. Negotiation rejects incompatible ranges. Clients validate correlation and version.
- A first subscription returns a coherent persisted snapshot and cursor. Later calls return typed `job_lifecycle`, `job_progress`, `job_removed`, `settings_changed` and `queues_changed` events with increasing sequence numbers.
- SQLite retains 2,048 events; batches are bounded to 1,000 (50 in the browser bridge). Missing/expired/future cursors reset to a snapshot. `has_more` supports bounded replay. Clients serialize polling to avoid reordering.
- Job creation includes a separate durable `request_id` and payload fingerprint. Repeated identical requests return one job; conflicting payloads and removed-job tombstones fail explicitly, including after restart.
- Browser projections exclude local destinations, settings, credential references and privileged commands. Desktop-only jobs and settings events are filtered. Failure codes and recovery actions are exposed without local failure details.
- `downloader --json watch` emits newline-delimited snapshot/event batches; human mode prints progress. The CLI fixture starts an isolated service, watches ordered events, pauses/resumes, verifies output and restarts to verify persistence.

## Recorded evidence

Tests are deterministic local fixtures, not proof of universal server/browser support. The [acceptance record](ACCEPTANCE.md) and [compatibility matrix](COMPATIBILITY.md) distinguish source builds from native GUI, browser and installer acceptance.

- Windows local: **37 Rust functional tests**, four ignored helpers invoked by parent tests, **18 TypeScript tests**, strict Clippy/formatting, both client builds and native desktop compilation.
- The [corrected three-platform run](https://github.com/gduplessy/Downloader/actions/runs/38102100627) passed all jobs. An earlier benchmark fixture leaked response counters; its failure was fixed rather than accepted as a server-limit result.
- The [initial large-file run](https://github.com/gduplessy/Downloader/actions/runs/38102452983) passed all **38 network/performance cases** and the actual >4 GiB transfer on Windows, macOS and Linux. Its macOS CLI IPC step failed. The [repair run](https://github.com/gduplessy/Downloader/actions/runs/38103251279) has passed macOS endpoint permissions/rebind and the real CLI restart workflow; final job status and the newer native creation/privacy fixture still need confirmation.
- Sanitized JSON is published under [evidence/transfer-engine-2026-10-10](evidence/transfer-engine-2026-10-10/). It contains fixture observations and metrics, not credentials, private data directories or session tokens. CI evidence identifies source revision and run; earlier local records identify environment and date.

| CI platform | libcurl / TLS | HTTP/2, FTP/FTPS, gzip, large files, NTLM/Negotiate capability flags |
| --- | --- | --- |
| Windows x64 | 8.22.0-DEV / Schannel | Reported available; protocol fixtures passed |
| macOS Apple Silicon | 8.7.1 / SecureTransport, LibreSSL 3.3.6 | Reported available; protocol fixtures passed |
| Ubuntu 24.04 x64 | 8.5.0 / OpenSSL 3.0.13 | Reported available; protocol fixtures passed |

Capability flags do not establish external NTLM/Kerberos realm acceptance or final installer dependency provenance. The application accepts only HTTP/HTTPS/FTP/FTPS even if the linked curl reports additional protocols.

### Actual large file and ZIP64

Each CI platform transferred **4,311,744,529 bytes**, paused above the 4 GiB boundary, reopened persisted state, resumed and independently verified SHA-256:

```text
2583e615a4e14f529b88110b69aa85e6118d1ccf1e5c12fc7afdde4773efd399
```

| Run | End-to-end seconds | Evidence |
| --- | ---: | --- |
| Windows local | 114.680 | [windows-large.json](evidence/transfer-engine-2026-10-10/windows-large.json) |
| Windows CI | 43.164 | [ci-windows-large.json](evidence/transfer-engine-2026-10-10/ci-windows-large.json) |
| macOS CI | 90.891 | [ci-macos-large.json](evidence/transfer-engine-2026-10-10/ci-macos-large.json) |
| Linux CI | 40.120 | [ci-linux-large.json](evidence/transfer-engine-2026-10-10/ci-linux-large.json) |

These are separate machines, not comparative platform performance measurements. The remote ZIP64 fixture places its central directory above 4 GiB and verifies a known entry. This does not complete broad archive-format acceptance (MGT-04).

### Windows performance measurements

Local Windows 11 Pro 10.0.26100, Intel Core i7-5820K at 3.30 GHz, 12 logical processors, Rust 1.93.1. Each row is the median of three optimized 32 MiB transfers. Time includes queueing, transfer, verification and publication; engine CPU/RSS exclude the Node fixture server. Checkpoint time is accumulated across checkpoints. Scan time is zero because scanning was not configured.

| Nominal chunk delay | Server cap | Connections | Seconds | MiB/s | CPU seconds | Peak RSS MiB | Checkpoint ms | Verify ms | Publish ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 ms | none | 1 | 0.951 | 33.65 | 0.391 | 14.71 | 213.5 | 211.9 | 1.11 |
| 0 ms | none | 4 | 1.158 | 27.65 | 0.656 | 14.84 | 196.2 | 229.7 | 1.11 |
| 2 ms | none | 1 | 8.511 | 3.76 | 0.641 | 14.71 | 138.8 | 220.2 | 2.14 |
| 2 ms | none | 4 | 2.241 | 14.28 | 0.641 | 14.89 | 222.1 | 276.5 | 0.95 |
| 2 ms | 2 | 1 | 8.567 | 3.74 | 0.812 | 14.73 | 203.3 | 227.8 | 0.88 |
| 2 ms | 2 | 4 | 6.569 | 4.87 | 0.719 | 15.30 | 168.5 | 222.2 | 0.99 |

The delay is a requested timer per 64 KiB chunk, **not network RTT**; Windows timer granularity changes actual elapsed waits. Segmentation helps this delayed fixture and costs more on unrestricted loopback. No universal speed multiplier is claimed. [Raw local measurements](evidence/transfer-engine-2026-10-10/windows-network.json) include all repeats, connection reuse and phase durations.

### IDM comparison pending

The installed IDM 6.43.15.2 was invoked twice through its documented `/d`, `/p`, `/f`, `/n` command-line workflow against the identical 32 MiB delayed fixture in isolated output folders. Each attempt observed **zero fixture requests and no output after 180 seconds**. Existing IDM downloads/settings were not changed. [Recorded attempt](evidence/transfer-engine-2026-10-10/idm-attempt.json).

ENG-10 remains open until a real IDM transfer can be measured; no relative throughput, CPU or memory claim is made.

## Reproduce

OpenSSL is required for disposable local fixture certificates. These fixtures do not disable production TLS validation.

```sh
cargo test -p downloader-core -p downloader-service -p downloader-cli --features downloader-core/fault-injection
CARGO_TARGET_DIR=.local/engine-target cargo build --release -p downloader-core --example qualify
node scripts/qualify-network.mjs .local/network-qualification --benchmark
node scripts/qualify-network.mjs .local/large-qualification --only large_over_4gib --large
cargo build -p downloader-service -p downloader-cli
node scripts/qualify-control.mjs .local/control-qualification
```

On PowerShell, set `$env:CARGO_TARGET_DIR = "$PWD/.local/engine-target"` before building. It also selects the CLI target for the control fixture. `OPENSSL`, `QUALIFY_BINARY` and `CLI_BINARY` can override executable paths. Use a fresh output folder for each run. Large fixtures use over 4 GiB of space; the completed output and partial state can temporarily coexist.

CI `workflow_dispatch` with `large=true` runs the large fixture on every matrix platform. Normal pushes run crash/protocol/performance/control fixtures. Artifacts separate transfer and IPC evidence. After confirming IDM is responsive, use `--only __none__ --idm "FULL_PATH_TO_IDMan.exe"` for an isolated IDM attempt.

## Remaining engine qualification

- Actual disk-full/permission/cross-volume failure matrices beyond injected I/O, locked-file, symlink/hardlink, collision and staged-copy regressions.
- External NTLM/Negotiate/Kerberos realms; platform system proxy/WPAD/PAC failure policies, ordered proxy failover, shipped installer/AppImage library provenance.
- Confirm the latest native-messaging creation/privacy fixture across CI platforms. Intel macOS is a separate launch target from the Apple Silicon CI runner.
- Successful identical-fixture IDM comparison. Stable-browser source refresh and desktop GUI acceptance remain in WEB/UI/REL gates.

Keep unresolved criteria in [the roadmap](ROADMAP.md#2-transfer-engine-correctness-and-networking), even when the corresponding source workflow is implemented.
