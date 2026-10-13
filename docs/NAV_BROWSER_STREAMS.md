# Direct browser streams (NAV-07/08/09/11)

The receiver publishes original response bytes through the existing SHA-256, scanner and no-overwrite pipeline. Chromium declares debugger permission in one extension build; direct capture remains disabled by default. Firefox has a separately gated response-filter lane. Live providers remain unqualified.

## Evidence on Windows x64

[Full production worker qualification](evidence/nav-browser-streams/README.md) now records original Blob, cancellation, replacement, tab-close and actual private Chrome/Edge rows separately from the earlier module harness. Its sanitized matrix preserves exact browser/source/native versions and remaining recovery/privacy rows.

### Earlier stream-module harness

- Installed stable Chrome `155.0.8059.39`: one POST submission, 8,388,625 original response bytes, and a separate original page Blob of 8,388,625 bytes. Both desktop artifacts completed and matched SHA-256 `c454f05473a97ef2f7a2c8d9ec8d08bc0de4268315e2c77ea6f16f7b91894a27`. Maximum retained raw native chunk: 196,608 bytes.
- Installed stable Edge `155.0.4283.45`: one POST submission and original page Blob, each 262,161 bytes, both Complete and matching SHA-256 `ea7079c478bfa028ecbe546e3f39bbf22aa9e5a5d575fd3854105c3c05d6a862`. Eight observed durable native ACKs: mean 352.675 ms, p95/max 954.4 ms. POST action-to-completion: 1,697.3 ms. The recorded Blob elapsed time includes the final control snapshot and is not an isolated transfer-throughput measure. An earlier 8 MiB run exceeded its 180-second fixture deadline under concurrent builds; it does not establish Edge large-file acceptance.
- These runs load a real temporary extension and exercise the production `armChromium`, `NativeStreamPort`, `DurableStreamSink`, scoped cookie-store lookup and isolated native daemon. CDP evaluates fixture orchestration; it never relays response bytes. The fixture bypasses the production background queue and adapter preview. Integrated preview authorization/cancellation and selected-host persistence require coordinator acceptance.
- Rust: 32 unit, 12 browser-stream, 7 solver, 15 transfer and 3 service tests passed; expected subprocess fixtures remain ignored in ordinary test enumeration. Required fault-injection suite, all-target Clippy and Rust formatting passed. Client type checks, 31 extension tests, 6 desktop tests, builds and artifact version checks passed.

## Reproduce without user profiles

From the worktree, first build `cargo build -p downloader-service -p downloader-cli`. Then run:

```powershell
node scripts/nav-fixtures/streams/extension-feasibility.mjs
$env:NAV_BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:NAV_BYTES = '262161'
node scripts/nav-fixtures/streams/extension-feasibility.mjs
```

The runner creates a unique `.fixture-streams/extension-<timestamp>` directory containing a browser profile, unpacked fixture extension, native allowlist, service DB, downloads and `evidence.json`. It uses a unique temporary native-host registry key, deletes only that key, and launches only its own browser/daemon with hidden Windows helper processes. Ordinary browser profiles, host registrations and service data are unchanged. Preserve ignored fixture evidence until reviewed. `protocol-feasibility.mjs` is a separate CDP feasibility gate and must not be substituted for extension/native acceptance.

Firefox stable `157.0.1` is installed at `C:/Program Files/Mozilla Firefox/firefox.exe`; no ESR executable was identified. The Chromium runner cannot qualify Firefox. To reproduce the Firefox lane, load `apps/extension/dist/firefox` as a temporary MV2 add-on in a new disposable profile, enable direct capture and grant webRequest/webRequestBlocking/site permissions, register the native host against a separate data directory, and submit the local one-use form. A Firefox automation runner and actual stable/ESR hash evidence remain pending. Neither Firefox API mocks nor browser availability establish support. macOS/Linux browser matrices and large-file performance remain pending.

## Contracts and integration hooks

- `scopeForTab` requires the actual tab's explicit cookie store/container and Chromium partition API. Missing APIs never fall back to a default store. `sessionKey` omits claim_generation; `sameScope` includes it.
- The bridge uses `browser_stream` operations `begin`, `chunk`, `end`, `abort` over persistent connectNative. Every operation carries `stream_id`, exact `scope` and `source_generation`. Chunk offsets and ACK offsets are durable; only identical retained bytes may be resent after a lost ACK. Frames remain below 1 MiB, with 192 KiB raw chunks and one outstanding frame.
- The service atomically records stream offsets, job progress and quota usage after file sync. EOF rejects zero length, mismatched totals, trailing unacknowledged bytes and stale ownership. Concurrent EOF and publication-before-terminal-checkpoint restart tests acknowledge one verified artifact.
- `ClaimNavigation` requires expected source_generation on already-scoped jobs. Same-session force renews claim_generation. Browser/profile/private/store/container/partition changes are denied; explicit authorized transfer is coordinator work. `Refresh` advances source_generation and claim_generation. Scoped `SolveChallenge`, `Resolve`, `BrowserStatus` and `RefreshBrowser` require both fences before any action.
- `browser_snapshot`/`browser_subscribe` accept `owner`, `private`, and exact `scopes`; scoped jobs/events are visible only through those scopes. Unclaimed public records are available only in the regular lane. Legacy snapshot/control paths cannot project or mutate scoped/private records.
- `resolverContext` returns `{tabId,frameId,scope,sourceGeneration,selectedHost,disabledAdapters,locale,capabilities:{pageBlob}}`; sourceGeneration comes from the claim, without generating a new authority. The coordinator owns selected-host persistence, disable-adapter dispatch and two-phase preview authorize/commit/abort. The integrated worker uses two-phase authorization and a one-use commit token; cancellation and binding rechecks precede capture. Installed fixtures separately qualify its final route.
- `armDirect` and `captureCancels` in background.ts are the worker hooks. Blob readers have an opaque sender-tab/frame capability and an explicit sink-abort cancellation hook. Chromium unused arms expire after 60 seconds. The worker disarms on preview cancellation and scope/document replacement; a timeout alone does not establish cancellation correctness.
- Chromium response metadata is admitted before irreversible `Fetch.takeResponseBodyAsStream`; original completion becomes an empty 204. Filename is derived from Content-Disposition, sanitized by the service. Encoded response Content-Length is not treated as delivered decoded-byte total. HTML/login/error responses stay in the original browser lane. Firefox filters wait for exact response metadata admission before sending bytes, suspend while awaiting durable ACK, and explicitly close/disconnect.
- Regular nonsecret resolver refs survive browser restart; request URLs, cookies, headers and non-hash preview fingerprints are session-only. A browser-session epoch prevents reused tab IDs from being trusted automatically. Cached regular scopes expose owned metadata for explicit Continue; new work must reclaim the original context. Private tasks need ephemeral session storage and their original private context. Private/container tasks never silently reopen in a normal default tab.
- New private service records/events and browser task context are ephemeral. Partial file bytes needed for interrupted writes can remain on disk and require explicit reauthorization. Diagnostics count pre-upgrade private DB records and explain that separate approved cleanup is required. This change does not sanitize or delete existing private history or WAL data.

API design sources are recorded in [SOURCES.md](plans/nav/SOURCES.md). Header/redirect/backpressure and session API mocks are regression evidence only; actual gzip/unknown-length/redirect/private/container browser matrices remain pending.

## Shared production worker qualification

`node scripts/nav-fixtures/streams/production-worker.mjs` builds the production background/resolver and replaces only the isolated native host name plus diagnostic error logging. The fixture uses a unique browser profile, host registration and service data directory; its minimal trusted options driver grants local fixture permissions. Initial Windows Chrome runs created and scoped the desktop navigation job but remained waiting before any POST. Canonical partition serialization and scoped browser-source admission now have regressions; the complete production-worker POST hash gate remains pending. This does not invalidate the separately qualified production stream-module Chrome/Edge hashes, whose harness bypasses background/resolver routing.

### First full production POST gate: passed (0.8.13)

The default, non-traced runner passed on installed Windows x64 Chrome 155.0.8059.39 using the production background/resolver and only an isolated native-host substitution. Exactly one original POST delivered 262,161 bytes to a completed native job; desktop SHA-256 was `ea7079c478bfa028ecbe546e3f39bbf22aa9e5a5d575fd3854105c3c05d6a862`. The incremental null-snapshot projection bug is fixed, and subscription cursors recover a full snapshot whenever visible scope authority changes. Earlier partition errors were incidental observer diagnostics; direct top-frame partition API calls succeeded. Subsequent Blob/cancel/replacement/private rows are recorded in the production qualification matrix above. Chrome worker-loss and native-service safe manual recovery now pass their exact matrix rows; complete browser restart, full session/container matrix, Firefox and account/challenge/discovery acceptance remain distinct.

### Final qualification increment (0.14.3)

Installed production Chrome Blob now records and verifies the exact native-host/daemon executable SHA separately from the CLI version. Chrome worker termination recovers with retained durable progress; native-service restart recovers to manual reauthorization with a verified original partial prefix and no publication. Actual Chrome/Edge private Blob hashes and a labeled shared-storage primitive probe pass. See the [sanitized matrix and reproduction commands](evidence/nav-browser-streams/README.md).

This checked base still rejects cross-session claims even with force; explicit authorized transfer and its installed proof are coordinator work. Complete browser restart, the full profile/container/partition matrix, actual private context-menu UI, Firefox binary form navigation, ESR, other OSes and live providers remain pending. Recovery does not imply replay or automatic continuation.
