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
node scripts/nav-fixtures/discovery/qualify.mjs
# Repeat for actual Edge:
$env:NAV_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/nav-fixtures/discovery/qualify.mjs
```

Each run creates an isolated data directory, browser profile, loopback origins and unique native-host registration. The driver only exposes fixture entry points and selects the real adapter preview; it detaches from the resource page before capture. Production native messaging and chrome.debugger carry the original bytes. No driver relay or substituted browser transport is used.

The restart mode delays rendering, stops/restarts the real service database owner and stops the actual extension ServiceWorker before attaching its replacement target. The saved browser epoch and resource order/scope remain fenced; the active frontier finishes after recovery without creating jobs or probing resources before selection.

## Acceptance boundaries

- Local stable Windows Chrome: actual cross-origin authenticated direct GET and active-frontier service/worker restart passed; retained source/resource scope, one GET, zero HEAD, 262,161 bytes and SHA-256 `ea7079c478bfa028ecbe546e3f39bbf22aa9e5a5d575fd3854105c3c05d6a862`.
- Local stable Windows Edge: final qualification in progress.
- Native real-engine tests cover stale reports/documents, private-at-creation ephemerality, explicit cross-origin permission, foreign cookie stores, scheduler capacity, preparation cancellation and idempotent restart selection.
- Browser absent/new browser epoch requires explicit session reauthorization; automatic enrollment into a default session is refused. Full browser-process restart qualification remains a distinct row.
- Firefox stable/ESR and macOS/Linux installed browser rows remain pending. Shared Firefox response-capture qualification is owned by the integration batch; unavailable targets require native CI/owner evidence.
- Live g4u, ddownload, Rapidgator and Gofile hosts/accounts remain pending. Paid-provider spending stays $0. Local fixtures do not qualify live providers.
- Keyboard/locale controls are implemented in six dictionaries; native-language and owner UI acceptance remain pending.
