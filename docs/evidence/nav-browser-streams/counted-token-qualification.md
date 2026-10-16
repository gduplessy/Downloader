# Counted one-use browser fetch to Blob qualification

The installed production extension fixture `scripts/nav-fixtures/streams/qualification.mjs` supports `NAV_CASE=consume-head|first-get|rotating-cookie|expiring-url|redirect-token`. Each mode starts one browser-owned fetch and materializes its original response as an owned Blob before the actual radio/Continue mouse selection streams it directly to the desktop. No browser-download/import path is used.

The server records every token request and rejects a consumed token, any HEAD, unexpected redirect path, range, or stale rotating cookie. The expiring mode expires immediately after its first accepted GET; it proves desktop capture never reopens that expired token, not the pre-request-expiry recovery UI. Redirect mode requires exactly one original browser GET per redirect hop. Successful acceptance requires the exact expected file hash and no native origin request.

Each run copies the matching immutable native25.1 service/CLI pair and verifies both complete SHA-256 values before startup. This fixture grants loopback and webNavigation capabilities; the installation/runtime permission prompt is not qualified. Source revision, driver and generated bundle hashes distinguish the actual installed code from subsequent evidence-only commits.

Run from this worktree on Windows with Chrome installed:

```powershell
$env:NAV_CASE='first-get'
$env:NAV_BYTES='1048593'
node scripts/nav-fixtures/streams/qualification.mjs
```

Set `NAV_BROWSER` to the actual Edge executable for an Edge repeat. Evidence is written to the uniquely owned `.fixture-streams/qualification-<mode>-<timestamp>/evidence.json` directory. Failed attempts retain `failure.json`. No passing public matrix is claimed until exact committed-source repeats are collected.

This lane does not qualify navigation-triggered debugger GET responses, pre-request expiry UI, bounded page memory, changed-partial source refresh or browser-loss recovery. The owner-deferred Firefox binary form/navigation lane, live providers/accounts and unavailable operating systems remain pending.
