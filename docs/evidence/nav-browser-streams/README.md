# Production browser stream qualification

These are actual local Windows x64 Chrome/Edge runs through the production background worker, resolver preview and persistent native transport. The [matrix](production-browser-matrix.json) records each exact source/native version and outcome. Passing rows do not close the broader NAV matrix.

## Verified rows

- Original page Blob: native file hash, zero original-link activations and no desktop origin request. Edge also completed 8,388,625 bytes; the earlier short-deadline attempt remains a failed attempt rather than a size-limit finding.
- Preview cancellation: zero native bytes. Ingress cancellation: actionable recovery without publication.
- Source replacement: source/claim advance and old-reader interruption. Document replacement and tab closure pass after the coordinator's scoped lifecycle fixes.
- Actual private Chrome and Edge workers: actual private tab/cookie-store membership, distinct private-cookie-derived file hash, scoped regular snapshots/capture visibility, and no fixture marker in local storage or service DB/WAL. The strengthened Chrome audit also excludes the private job ID from those durable locations.

## Reproduce

Use a dedicated worktree and its own Cargo target; first build `cargo build -p downloader-service -p downloader-cli`.

```powershell
$env:NAV_CHECKED_BASE = (git rev-parse HEAD)
$env:NAV_BYTES = '262161'
node scripts/nav-fixtures/streams/qualification.mjs
$env:NAV_BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/nav-fixtures/streams/qualification.mjs
node scripts/nav-fixtures/streams/private-qualification.mjs
```

`NAV_CASE` supports `blob`, `preview-cancel`, `preview-document-replacement`, `blob-revoked`, `capture-cancel`, `document-replacement`, `source-replacement`, `worker-loss`, `service-reconnect`, and `tab-close`. Use `NAV_BYTES=33554449` for ingress interruption and `NAV_DEADLINE_MS=240000` for larger-file runs. Each run uses a unique profile, native registration, DB, port and artifact folder under ignored `.fixture-streams/qualification-*`. Preserve its evidence until reviewed. Cleanup removes only its own registration and stops its own helpers.

The shared driver builds unchanged production background/resolver modules, replacing the native-host name with its unique fixture registration. It sets fixture permissions/settings through a trusted extension page; real settings/permission-modal UI remains pending. The preview uses actual mouse selection and Continue/Cancel. CDP never transports file bytes. `NAV_TRACE=1` adds diagnostic logging and produces `diagnostic-passed`, which is excluded from acceptance. Private tracing is rejected.

Private bootstrap uses the actual installed browser's `Extensions.loadUnpacked.enableInIncognito`, an actual private window, real split worker and cookie-store membership. Its approved synthetic context-menu event invokes the unchanged registered production handler with the actual private tab. Native context-menu UI activation remains pending. The storage observer imports the exact production facade against actual local/session areas; it never fabricates incognito flags or claims.

## Open rows

- Worker termination: the original worker target was confirmed gone after partial ingress; the job remained BrowserDownloading with stale streaming status on 0.12.10. A coordinator recovery fix and repeat qualification are required.
- Native-service restart/reconnect and complete browser restart require repeat scoped recovery qualification.
- Actual simultaneous profile/partition/container races, primitive browser-download mapping isolation, legacy private-history cleanup and owner transfer remain separate acceptance rows. No old private DB history has been deleted or claimed sanitized.
- Firefox stable capture is being diagnosed by the coordinator; do not generalize one failing download lane to all Firefox navigation. Firefox ESR is unavailable on this machine. macOS/Linux and live g4u/ddownload/Rapidgator/Gofile accounts remain pending.
- Sampled worker heap is an observed maximum, not a proof of peak process memory or constant memory. Full-worker progress timing includes authorization and durable service admission; stream-module ACK timing is documented separately.
