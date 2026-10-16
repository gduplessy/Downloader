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
