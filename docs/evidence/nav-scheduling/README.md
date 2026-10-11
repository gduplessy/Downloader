# NAV-04 / NAV-10 local qualification

Date: 2026-10-11. Target: Windows, gstack HeadlessChrome 145.0.7632.6, isolated real Rust Engine and production scheduler options component.

## Evidence

- [Browser fixture record](browser-fixture.json): fifty jobs queued; three and twenty actual renderer tabs admitted; reducing the limit retained existing leases; admission beyond the limit denied; visible settings and pause controls exercised.
- [Wait lifecycle record](wait-lifecycle.json): same-host serialization, replaced wait rejection, elapsed deadline with unready server, actual Engine process restart, live-tab reconciliation, expired token and cancellation.
- [Queue screenshot](queue-ui.png): production scheduler component rendered with fixture CSS and transport.
- At three admitted tabs, the isolated browser process tree used 606.9 MiB working set and 189 MiB private memory; at twenty it used 2424.9 MiB and 813.6 MiB. These are single-run fixture observations, not production resource guarantees. Renderer pages use one local UI fixture origin; engine job identities use distinct synthetic hosts.

## Automated checks

- Eleven Rust scheduler policy regressions cover caps, fairness, priority, pause, live-tab leases, replacement fencing, expiry, redirect locks, notification claim and persistence.
- Four real Engine integration regressions cover restart/profile authority, private scheduler persistence exclusion, limit validation and unresolved readmission without reviving cancelled jobs.
- Extension regressions cover countdown extraction, invalid/hidden clocks, alarm recovery, denied notification permission, delayed wake and once-per-generation behavior. Stale source/replaced wait alarms cannot wake current actions. Wait fingerprints are bounded opaque SHA-256 values.
- Full Rust tests, Clippy, formatting, both client typechecks/tests/builds and generated Chromium/Firefox manifest versions are checked before the qualification commit.

## Scope boundaries

The browser harness substitutes the extension browser API transport with an HTTP shim connected to the actual isolated Rust Engine. It tests production queue UI and service policy; it does not qualify installed-extension native messaging, browser alarm delivery, or stable Chrome/Edge/Firefox restart behavior. Their deterministic regressions are separate evidence.

This batch's intermediate service enrollment uses source_generation=1 and first-attach scope validation. The coordinator must reconcile persisted Job.source_generation and Job.navigation_scope on every enrollment/snapshot, reject stale scope even for Reconcile, invalidate waits on source/claim changes, and atomically extend redirect host locks. These exact ownership fences are a pending B/C integration dependency; this fixture does not claim NAV-11 acceptance.

Live g4u, ddownload, Rapidgator and Gofile files/accounts remain pending by owner instruction. All timer-dependent tasks retain their live tab; no adapter has yet qualified tab recreation or instant download. Paid CAPTCHA qualification budget remains $0.

## Reproduce

From this worktree, with dependencies installed:

```powershell
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) 'target-nav-scheduling'
cargo build -p downloader-core --example navigation_scheduler_fixture
node scripts/nav-fixtures/scheduler/server.mjs
```

In a second terminal in the same directory, run `node scripts/nav-fixtures/scheduler/qualify.mjs`. Restart the fixture server for a fresh database, then run `node scripts/nav-fixtures/scheduler/lifecycle.mjs`. Set BROWSE_CLI to the gstack browse binary if it is not at the default Windows installation path. Server uses a random loopback port, per-run fixture database, copied helper executable and dedicated gstack state. Evidence excludes credentials and raw source URLs.
