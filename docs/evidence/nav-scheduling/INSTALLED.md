# Installed scheduler qualification

Run from the repository root on Windows with a built service/CLI pair and Chrome or Edge:

```powershell
$env:NAV_NATIVE_BINARY = 'C:/path/to/downloader-service.exe'
$env:NAV_CLI_BINARY = 'C:/path/to/downloader.exe'
$env:NAV_NATIVE_REVISION = '<revision that built both executables>'
$env:NAV_WORKER_RESTART = '1'
node scripts/nav-fixtures/scheduler/installed.mjs
```

`NAV_BROWSER` selects the browser executable. The driver uses a unique temporary profile, native host registration and service data directory. It builds the production background/resolver/options/content entry points; the only source substitution is the unique native-host address. Permissions are pregranted for loopback and synthetic DNS-mapped `.scheduler.test` hosts. No browser API transport shim or page-to-engine proxy is used.

The server advertises a one-second DOM countdown but enforces forty-five seconds before accepting the original POST. The driver requires real durable wait metadata and a browser alarm, verifies no submission after the local deadline, optionally terminates and observes replacement of the actual worker, then selects the production preview controls. It separately queues twenty-one distinct hosts, observes default-three and configured-twenty native leases and twenty real tabs, samples the fixture browser process tree, and verifies same-host serialization while a global slot is free. Lowering the configured limit preserves existing admissions.

Output is written to `docs/evidence/nav-scheduling/installed-readiness.json` only after all assertions pass. Detailed temporary artifacts stay under ignored `.fixture-streams/scheduler-installed-*`. Resource samples describe one test machine; they do not establish a memory bound.

## Remaining boundaries

- Navigation Retry-After ingestion remains pending: `retryAfter()` currently has no production caller. The server rejects premature requests with 429/Retry-After, but a successful zero-premature-request row does not prove header ingestion.
- Historical 0.22.0 extension queue cancellation failed the service scope fence. Scoped cancellation passed actual Chrome/Edge checks at 4cfed4d/native0.23.2 and again on the final combined runtime/native `3b808ae`/0.25.1: `installed-cancellation-chrome-0.25.1.json` and `installed-cancellation-edge-0.25.1.json`. Both current rows verify native Cancelled, alarm/record/reservation removal, owned resolver closure, an unrelated same-site user tab retained, no original submission and no desktop cancel fallback. That user tab has no task-origin record; this is not original-source binding qualification. Use `NAV_CANCEL_ONLY=1` to reproduce.
- `NAV_CANCEL_QUEUED=1` passed on the same final combined pair: `installed-queued-cancellation.json` verifies the unadmitted 21st row, refused foreign/private/stale/legacy commands, exact idempotent native acknowledgement, ordinary-download legacy cancellation and preservation of the active peer. Its older checked 3d6bd4d/native0.23.4 row remains in `installed-queued-cancellation-0.23.4.json`. Historical queue resource evidence used desktop cancellation.
- The first final queued attempt completed all assertions but retained an esbuild child after browser/service/server/registry cleanup; only its owned fixture Node process was stopped. The published driver explicitly stops esbuild. Queued and sequential Chrome/Edge scoped repeats then exited zero with unchanged production sources/binaries and published driver SHA `d052be76e9342cabba9948607645f252abc5f497943a07fef86d6677fd3165fb`. The driver-only cleanup edit was present during these runs; recorded source revision denotes production/runtime, while the exact driver hash identifies the exercised fixture. An earlier concurrent Edge0.23.4 attempt failed its countdown precondition before cancellation; it contributes no acceptance evidence.
- Product0.25.2 publishes fixture cleanup, evidence and audit/version metadata only. The checked native/CLI pair remains 0.25.1, built at3b808ae; no 0.25.2 native rebuild or installed run is claimed.
- Whole-browser restart, real sleep/clock changes, notification denial and unavailable OS/browser matrices remain separate gates.
- These pages are synthetic. Live provider/account and paid-provider acceptance remain deferred under the owner decisions.
- The readiness POST returns an HTML acknowledgement. No file-transfer success is claimed by this fixture.
