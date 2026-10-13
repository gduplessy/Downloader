# Rendered discovery qualification

NAV-12 uses service-owned bounded frontiers, exact original-session ownership and live document proofs. Selection opens approved HTML provenance through a bounded scheduler preparation lease before authorizing the exact original resource control; discovery sends no resource probes.

## Reproduction

Run in the discovery worktree on Windows with actual installed Chrome or Edge, Node, pnpm and Rust available:

```powershell
$env:CARGO_INCREMENTAL='0'
cargo build -p downloader-service -p downloader-cli
pnpm build
$env:NAV_CROSS_ORIGIN='1'
$env:NAV_RESTART_SERVICE='1'
$env:NAV_RESTART_WORKER='1'
$env:NAV_RESTART_BROWSER='1'
node scripts/nav-fixtures/discovery/qualify.mjs
# Repeat for actual Edge:
$env:NAV_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/nav-fixtures/discovery/qualify.mjs
```

Each run creates an isolated data directory, browser profile, loopback origins and unique native-host registration. The driver only exposes fixture entry points and selects the real adapter preview; it detaches from the resource page before capture. Production native messaging and chrome.debugger carry the original bytes. No driver relay or substituted browser transport is used.

The restart mode delays rendering, stops/restarts the real service database owner and stops the actual extension ServiceWorker before attaching its replacement target. The saved browser epoch and resource order/scope remain fenced; the active frontier finishes after recovery without creating jobs or probing resources before selection.

## Acceptance boundaries

- Local stable Windows Chrome: actual cross-origin authenticated direct GET and active-frontier service/worker restart passed; retained source/resource scope, one GET, zero HEAD, 262,161 bytes and SHA-256 `ea7079c478bfa028ecbe546e3f39bbf22aa9e5a5d575fd3854105c3c05d6a862`.
- Local stable Windows Edge: actual cross-origin, browser-process, active-frontier service and worker restart passed with the same one-request hash.
- Native real-engine tests cover stale reports/documents, private-at-creation ephemerality, explicit cross-origin permission, foreign cookie stores, scheduler capacity, preparation cancellation and idempotent restart selection.
- Browser absent/new browser epoch requires explicit session reauthorization; automatic enrollment into a default session is refused. Actual Chrome browser-process close/reopen followed by explicit original-session reauthorization passes with the expected original-GET hash; clean committed Chrome/Edge evidence is recorded below.
- Firefox stable/ESR and macOS/Linux installed browser rows remain pending. Shared Firefox response-capture qualification is owned by the integration batch; unavailable targets require native CI/owner evidence.
- Live g4u, ddownload, Rapidgator and Gofile hosts/accounts remain pending. Paid-provider spending stays $0. Local fixtures do not qualify live providers.
- Keyboard/locale controls are implemented in six dictionaries; native-language and owner UI acceptance remain pending.

## Committed-source evidence

- [Chrome 155 Windows x64](committed-chrome-windows-x64.json) and [Edge 155 Windows x64](committed-edge-windows-x64.json) qualify committed 7f752d3 (0.13.2), sourceDirty=false. Both use copied native executable SHA-256 and the exact resolver bundle SHA-256 recorded in JSON.
- One earlier Edge pre-integration attempt stopped before any resource request (WaitingBrowser, zero bytes); the repeat and clean committed rows completed. Same-live-document startup coalescing is included in the checked shared base; no fallback or ownership gate was weakened to obtain acceptance.
- Both final rows include checked main/shared WaitingUser/countdown recovery. The 0.13.3 documentation/version increment records this immutable 0.13.2 source evidence; browser evidence never silently relabels its source revision.
