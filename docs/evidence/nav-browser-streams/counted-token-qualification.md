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

Set `NAV_BROWSER` to the actual Edge executable for an Edge repeat. Evidence is written to the uniquely owned `.fixture-streams/qualification-<mode>-<timestamp>/evidence.json` directory. Failed attempts retain `failure.json`. The checked [Chrome Windows matrix](counted-token-chrome-win32.json) passed all five cases at exact source `a70294d31924cc6eabf5e5906653c5e0cae01253` (0.32.0), Chrome155.0.8059.40 and matching immutable native25.1. Every file is 1,048,593 bytes with SHA-256 `016dda9740d1ce7161d4e53fd1f5eea4558b0a1c8429ac4961dc11338f2bc348`. The first four cases issued one original browser GET; redirect-token issued exactly one GET per hop. All recorded zero HEAD, range and native origin requests. The complete sequential matrix process exited0.

The consume-head and redirect cases showed delayed process cleanup after payload acceptance; an exact-profile orphan Chrome crashpad helper was observed during final cleanup and exited naturally before any cleanup action. No process was force-terminated. This observation does not establish the delay cause. The initial uncommitted attempt lacked the new fixture webNavigation grant and failed setup before acceptance; it is excluded from this checked matrix.

The expiry case expires the URL after the first accepted request. A response already expired before its first request is not qualified by this matrix.

This lane does not qualify navigation-triggered debugger GET responses, pre-request expiry UI, bounded page memory, changed-partial source refresh or browser-loss recovery. The owner-deferred Firefox binary form/navigation lane, live providers/accounts and unavailable operating systems remain pending.
