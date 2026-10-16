# Whole-browser loss qualification

`NAV_CASE=browser-loss` extends the installed production Blob driver. After observing durable native bytes while the job remains incomplete, it closes the actual isolated browser with CDP `Browser.close`, verifies the spawned browser process exits, and stops accessing extension APIs. The native daemon remains running.

The driver requires native monotonic reader-lease expiry to produce `browser_reader_lost` / `waiting_user`, unchanged source and claim generations, no final publication, and the exact retained durable-prefix hash. It never replays the Blob URL or creates a replacement request. Page/source/worker loss remain separate rows. The driver requires actual partial progress; missing the interruption window is a failure.

```powershell
$env:NAV_CASE='browser-loss'
$env:NAV_BYTES='16777233'
node scripts/nav-fixtures/streams/qualification.mjs
```

The existing transfer deadline is unchanged; native reader expiry is45seconds. This mode currently targets regular Chromium profiles only. Whole-browser loss on Firefox, private profile cleanup, reauthorization UI and fresh-token changed-partial recovery remain separate obligations.

No installed acceptance is claimed until a committed-source run and overall process exit0 are recorded. After its owned browser exits, the driver destroys its own inherited stderr pipe because Windows crashpad may retain that pipe. It closes the fixture-owned HTTP connections/server and stops esbuild in cleanup. This does not terminate any unrelated browser or service.

Installed Chrome155 Windows passed at exact `ac261da` (extension0.34.6, immutable native0.25.1). A67108881-byte owned Blob was interrupted after196608 durable bytes; the reader stopped with458752 bytes after in-flight acknowledgments settled. Actual browser exit0 was confirmed. At45809ms after loss native reported `browser_reader_lost` / WaitingUser, retained matching458752-byte partial SHA256 `5a32e625f0c3d3da525eb339459f14e2e2e5c68fe57786512a2ae122161bea64`, and preserved source/claim generation1. No final publication, origin response request or native refetch occurred. The fixture process exited0. This proves the regular-profile Chrome Blob lane only; POST/navigation response, Edge and other contexts remain separate. Sampled worker heap is not a memory bound.

Installed Edge155 Windows also passed at exact `ac261da` with the same immutable native pair and67108881-byte Blob. The checked Edge JSON retains its own interruption bytes, final durable prefix/hash and monotonic expiry observation. Actual browser exit and fixture exit0 were confirmed; ownership generations remain unchanged, no final file or origin response fetch occurred. Together these records qualify the regular Chrome/Edge Blob browser-loss rows, without extending that proof to navigation responses or other contexts.
