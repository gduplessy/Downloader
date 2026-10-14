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
- Historical 0.22.0 extension queue cancellation failed the service scope fence. The new scoped cancellation command/coordinator has native and extension regressions; its installed requalification uses `NAV_CANCEL_ONLY=1` and remains pending until its separate evidence row passes. Historical queue resource evidence used desktop cancellation.
- Whole-browser restart, real sleep/clock changes, notification denial and unavailable OS/browser matrices remain separate gates.
- These pages are synthetic. Live provider/account and paid-provider acceptance remain deferred under the owner decisions.
- The readiness POST returns an HTML acknowledgement. No file-transfer success is claimed by this fixture.
