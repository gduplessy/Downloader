# Actual Chromium top-level cookie partitions

This local NAV-11/NAV-12 gate uses two real top-level sites, `http://a.localhost` and `http://b.localhost`, in the same installed browser profile and cookie store. Both embed the identical `embed.localhost/embedded` URL and set the same-name Secure, SameSite=None, Partitioned `fixture_auth` cookie. The pages make exactly one credentialed browser GET of the identical embedded payload URL, then expose their original page-owned Blob. Trusted localhost HTTP is used; both HTTP and HTTPS localhost fixture permissions are required for the actual cookie API to observe Secure cookies.

The unchanged production resolver owns frame 0, obtains actual browser partition/document authority and captures that page-owned Blob through production native messaging. The driver never relays bytes or fabricates a SessionScope. Actual `cookies.getPartitionKey` proofs retain the difference between top frame (no cross-site ancestor) and embedded frame (cross-site ancestor). Both native files independently match different expected SHA-256 hashes, with zero native origin fetches and no HEAD requests.

- First: 262,161 bytes, `ea7079c478bfa028ecbe546e3f39bbf22aa9e5a5d575fd3854105c3c05d6a862`.
- Second: 262,161 bytes, `fc55ee5d7a5516e4f888e2bb43fa66637b1c1a26d69f3298b6e8701cfb651d83`.
- Exact production source is checked `d83fbbe608f83567d6429793004d449278a54c15`, with explicit esbuild absWorkingDir, per-input SHA-256 and bundle hashes. Native CLI reports 0.18.0; copied canonical CLI/host hashes are recorded before and after. Product 0.22.0 is an evidence/fixture increment, not a claim of a rebuilt native executable.
- A separate real installed extension without cookie permission observes the API unavailable, refuses before any job creation, and verifies the native zero-job snapshot plus zero origin requests.

Run from a checked workspace with canonical `target/debug/downloader.exe` and `downloader-service.exe`:

```powershell
node scripts/nav-fixtures/streams/partition-qualification.mjs
$env:NAV_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/nav-fixtures/streams/partition-qualification.mjs
Remove-Item Env:NAV_BROWSER
$env:NAV_PARTITION_NO_COOKIES='1'
node scripts/nav-fixtures/streams/partition-qualification.mjs # expected nonzero; inspect blocked evidence
Remove-Item Env:NAV_PARTITION_NO_COOKIES
```

Recorded targets: Chrome 155.0.8059.39 and Edge 155.0.4283.45, Windows x64. Each positive record includes both native hashes and one independently queried cookie in each real partition. The no-permission Chrome record has zero native jobs and zero origin requests. All three records match the checked fixture file SHA-256 `a8c04ce5f7a83162086e6a0130aed1da30004578ba6cfb994a7572de8c9866e4`.

Integration note (0.22.0): the recorded fingerprint is the LF repository content. A Windows CRLF checkout has different raw bytes; normalizing only CRLF to LF reproduces the recorded fingerprint. The evidence was imported unchanged from commit 038910a; its historical checked runtime was not rerun by this documentation integration.

Validation: script syntax and formatting, synchronized versions, application types and both browser builds passed. Extension 152/152 and desktop 56/56 regressions passed. The initial parallel suite hit two existing test deadlines under concurrent browser runs; the subsequent serial extension run preserved all assertions and passed. Native binaries were reused with exact before/after hashes; no Rust source changed or native build is implied.

The fixture preserves its raw build metadata, generated driver and result in `.fixture-streams/qualification-blob-*`; each profile, data directory, loopback port and native-host registration is unique, with registration removed on exit. Closed previews are driven with actual radio/Continue input. The download control remains hidden until the Blob is ready, avoiding a fabricated early empty-link candidate.

These records qualify top-frame partition ownership and page-owned Blob capture only. Arbitrary embedded-frame resolver/capture remains unsupported; no iframe capture is claimed. Cookie values, request headers and bytes are not written into evidence. Permission-prompt UI, live hosts/accounts, Firefox/ESR and unavailable operating systems remain separate pending rows. Heap samples are observations, not a peak-memory proof.
