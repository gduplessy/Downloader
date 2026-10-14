# Installed Firefox interruption investigation

The fixture `scripts/nav-fixtures/streams/firefox-stream-recovery.mjs` uses an isolated Firefox profile, copied native executables, original page-owned Blob, actual container authority and production stream transport. Initial activation invokes the registered menu listener with actual tab metadata; it does not qualify native menu UI.

Set `NAV_NATIVE_BINARY`, `NAV_CLI_BINARY` and the exact `NAV_NATIVE_REVISION`, then run with `NAV_RECOVERY_MODE=cancel`, `revoked-blob`, `reader-loss` or `service-loss`. Keep `NAV_TRACE`, `NAV_RPC_TRACE` and `NAV_NATIVE_STDERR` at `0` for acceptance. Each run writes ignored `.fixture-streams/firefox-recovery-*` artifacts. The fixture targets Windows; daemon interruption checks the unique copied executable, command, PID and creation identity before stopping it, verifies exit, and observes ordinary service restart.

Checked runtime a888dbf / native d83fbbe (0.18.3), Firefox 158, Windows:

- Revoked Blob: one diagnostic run passes WaitingUser with zero bytes, absent partial/final publication, one original producer GET and matching interrupted marker/document ownership. The preceding run drifted to WaitingBrowser during settling. Repeat acceptance and the intermittent race remain pending.
- Service loss: the exact daemon was terminated and a distinct replacement observed. WaitingUser timed out. Read-only SQLite/WAL inspection shows BrowserDownloading, 6,590,464 bytes, source generation 1 and a nonterminal checkpoint at the same offset; no later progress events. Native checkpoint replay across restart is an existing tested contract. The extension's interrupted marker currently excludes this failed-abort case from ordinary recovery polling; exact-stream abort retry is the repair target. This is a reproduced interruption-recovery gap, not successful qualification.

The public JSON is sanitized and preserves exact historical provenance. Later fixture diagnostics may change the fixture hash; they do not retroactively change recorded runs. No bytes were relayed by the driver and no native payload refetch was used. Private-addon permission, ESR, other operating systems, live hosts/accounts and ordinary Firefox binary form navigation retain their separate acceptance boundaries.
