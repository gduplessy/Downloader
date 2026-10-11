# Transfer engine implementation plan

Scope: ENG-01 through ENG-10 in [ROADMAP.md](ROADMAP.md). Work happens on `feat/transfer-engine-correctness`, in focused, verified commits, with one final PR. Do not merge the PR automatically.

## Batches and acceptance

1. **Baseline and filesystem invariants (ENG-06):** repair absolute defaults, bound portable filenames, validate checkpoint topology/offsets, reject unsafe partial paths, and verify collision-safe finalization. Keep existing correctness assertions intact.
2. **Transfer and recovery (ENG-01/02/03/05/08):** structured failure/recovery codes; valid empty and compressed streams; HEAD fallback and redirect handling; retries with durable offsets and Retry-After; FTP resume; recoverable verification/publication/scanning with no overwrite. Add deterministic hostile-response, offset, storage, and recovery fixtures.
3. **Connections and networking (ENG-04/07):** bounded reusable libcurl handles with session/routing isolation, host/global admission, concurrency backoff, explicit routing/auth/TLS configuration, and capability diagnostics. Qualify protocols/proxies/authentication with local fixtures; report external-realm and platform gaps explicitly.
4. **Control contract (ENG-09):** typed sequenced lifecycle/progress events, version negotiation, snapshot-first reconnects, bounded replay, durable idempotency, browser-safe projection, and CLI/client integration. Test restart and duplicate requests.
5. **Evidence and documentation (ENG-10 plus all gates):** reproducible latency/server-limit benchmarks with hashes, CPU/memory/finalization metrics; opt-in >4 GiB checks and remote ZIP64 offsets; CI artifacts; actual protocol capability reports; README/roadmap/acceptance updates. IDM comparison requires an available installed copy; absence is recorded, not fabricated.

## Correctness rules

- Never append a full or malformed response to a range. Never combine remote revisions.
- Checkpoints describe bytes that have been synced to storage; validate persisted offsets before use.
- Retries are bounded and cancellation-aware. Authentication/source/storage failures have actionable codes.
- Publication is no-overwrite and recoverable; verification/scanning failures cannot produce a Complete job.
- Cookies, credentials, proxies, and authenticated connections cannot cross unintended routing/session boundaries.
- Events have typed payloads and sequence numbers; reconnect starts with a coherent snapshot. Browser events exclude privileged settings and local paths.

## Validation

Run Rust fixtures, formatting, Clippy, desktop/extension type checks and tests for each affected boundary. Run the new networking fixtures and benchmarks with isolated data/output directories. Publish exact results and actual targets in the final PR; keep source completion, deterministic tests, CI, native/platform acceptance, and IDM comparison separate.
