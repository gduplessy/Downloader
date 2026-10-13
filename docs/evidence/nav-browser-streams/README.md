# Production browser stream qualification

These are actual local Windows x64 Chrome/Edge runs through the production background worker, resolver preview and persistent native transport. The [matrix](production-browser-matrix.json) records source revision, separately labeled CLI version, selected executable identity where captured, and outcome. Passing rows do not close the broader NAV matrix.

## Verified rows

- Original page Blob: native file hash, zero original-link activations and no desktop origin request. Edge also completed 8,388,625 bytes; the earlier short-deadline attempt remains a failed attempt rather than a size-limit finding.
- Preview cancellation: zero native bytes. Ingress cancellation: actionable recovery without publication.
- Source replacement: source/claim advance and old-reader interruption. Document replacement and tab closure pass after the coordinator's scoped lifecycle fixes.
- Actual private Chrome and Edge workers: actual private tab/cookie-store membership, distinct private-cookie-derived file hash, scoped regular snapshots/capture visibility, and no fixture marker in local storage or service DB/WAL. The strengthened Chrome audit also excludes the private job ID from those durable locations. A labeled seeded primitive-mapping probe on actual split-browser storage confirms that regular reads and removal cannot access the private namespace; it does not qualify an actual browser-download event. The matrix preserves the pre-fix c310942 read/removal failure alongside the passing 52c0d98 repeat.

- Genuine Chrome worker termination: the attached observer was detached first and the old worker target was confirmed gone. Recovery enters WaitingUser with 393,216 durable bytes and `browser_worker_interrupted`, without publication or a replacement reader.
- Chrome native-service termination/restart: the original daemon exited and a new daemon used the same executable/data directory. Recovery entered WaitingUser after 9,012 ms, retained 65,536 bytes, and the on-disk partial prefix matched the original source. Capture was interrupted and no final file was published. This qualifies safe manual reauthorization, not automatic continuation; the observed optional typed reason was absent.

## Executable provenance

The fixture selects its own `target/debug/downloader-service.exe` for both the native-host manifest and daemon process. The fresh Chrome 262,161-byte row captures that executable's SHA-256 before launch and verifies it remains unchanged at completion: `91f3ab4f16b7fc79f92c1a9fbca9774e2ad0dc2b371cb450744b54ca523c5531`, 17,117,184 bytes, built 2026-10-13 12:33:25 UTC after checked c310942 (0.14.1). The selected CLI is recorded separately (`f3f90851fe831ffa916c2c790d74fcd2406dc4ce943c42bbad731a5a1dfd0812`, self-reported 0.14.1). The service executable has no version handler; CLI or daemon diagnostics are not native-host version evidence. Historical rows without executable hashes retain that provenance limitation. Driver and private-helper hashes identify the fixture code; the latest runner also rejects replacing the native executable mid-run.

## Reproduce

Use a dedicated worktree and its own Cargo target; first build `cargo build -p downloader-service -p downloader-cli`.

```powershell
$env:NAV_CHECKED_BASE = (git rev-parse HEAD)
$env:NAV_BYTES = '262161'
node scripts/nav-fixtures/streams/qualification.mjs
$env:NAV_BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/nav-fixtures/streams/qualification.mjs
node scripts/nav-fixtures/streams/private-qualification.mjs
$env:NAV_AUDIT_PRIMITIVES = '1'
node scripts/nav-fixtures/streams/private-qualification.mjs
```

`NAV_CASE` supports `blob`, `preview-cancel`, `preview-document-replacement`, `blob-revoked`, `capture-cancel`, `document-replacement`, `source-replacement`, `worker-loss`, `service-reconnect`, and `tab-close`. Use `NAV_BYTES=33554449` for ingress interruption and `NAV_DEADLINE_MS=240000` for larger-file runs. Each run uses a unique profile, native registration, DB, port and artifact folder under ignored `.fixture-streams/qualification-*`. Preserve its evidence until reviewed. Cleanup removes only its own registration and stops its own helpers.

The shared driver builds unchanged production background/resolver modules, replacing the native-host name with its unique fixture registration. It sets fixture permissions/settings through a trusted extension page; real settings/permission-modal UI remains pending. The preview uses actual mouse selection and Continue/Cancel. CDP never transports file bytes. `NAV_TRACE=1` adds diagnostic logging and produces `diagnostic-passed`, which is excluded from acceptance. Private tracing is rejected.

Private bootstrap uses the actual installed browser's `Extensions.loadUnpacked.enableInIncognito`, an actual private window, real split worker and cookie-store membership. Its approved synthetic context-menu event invokes the unchanged registered production handler with the actual private tab. Native context-menu UI activation remains pending. The storage observer imports the exact production facade against actual local/session areas; it never fabricates incognito flags or claims.

## Open rows

- Complete browser restart, Edge worker/service recovery, simultaneous profiles, partitioned cookies and Firefox containers remain separate installed acceptance rows.
- Explicit cross-session owner transfer is absent from this checked base: same-session force renews a claim; foreign profile/private/store/container/partition claims are refused. The coordinator owns the guarded transfer implementation and its eventual installed proof.
- Actual browser-download-event mapping lifecycle, native private-context-menu UI and settings/permission prompts remain pending. The passing seeded mapping probe establishes storage fencing only.
- Legacy private-history cleanup remains separately approval-gated; no old DB history has been deleted or claimed sanitized.
- The owner explicitly keeps Firefox 157 binary form-navigation/download capture pending while supported direct-stream lanes are finished; Firefox Blob qualification is owned by the coordinator/challenge batch. Do not generalize the binary lane to all Firefox navigation. Firefox ESR is unavailable on this machine. macOS/Linux and live g4u/ddownload/Rapidgator/Gofile accounts remain pending.
- Sampled worker heap is an observed maximum, not a proof of peak process memory or constant memory. Full-worker progress timing includes authorization and durable service admission; stream-module ACK timing is documented separately.

## Verification for this increment

Both client type checks, all 145 extension and six desktop tests, both client builds, artifact-version checks and fixture JavaScript syntax checks pass. Complete Rust workspace tests (including Windows desktop native-source compilation), strict all-target Clippy, formatting, and the documented fault-injection tests/Clippy all passed again for 0.14.3. The installed native fixture rows used the separately identified c310942 (0.14.1) executable; this increment changes fixture/evidence and release metadata. Unit and API tests remain separate from the installed rows above.
