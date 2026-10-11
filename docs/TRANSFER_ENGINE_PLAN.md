# Transfer engine implementation plan

Scope: ENG-01 through ENG-10 in [ROADMAP.md](ROADMAP.md). The original work was merged in [PR #1](https://github.com/gduplessy/Downloader/pull/1). Qualification follow-ups continue on `feat/transfer-engine-correctness` in focused, verified commits and a new PR. Do not merge automatically.

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

## Increment status

The 0.3.0 follow-up implements bounded ordered proxy failover in all three native adapters and all file-request paths. It adds live proxy-traversal assertions and refuses Windows implicit loopback bypass in explicit PAC mode. ENG-07 still requires the managed-policy/external-realm matrix; a feature implementation does not close those acceptance criteria.

Batches 1–4 are implemented with deterministic regressions. Batch 5 publishes [reproducible evidence](TRANSFER_ENGINE.md), including actual large-file and real native-messaging/CLI runs on all three CI platforms. Follow-ups pass ordered PAC fixtures on every platform, real NTFS/HFS+/ext4 recovery (ENG-06) and 13 real AD realm checks. Remaining ENG-01/07/10 qualification criteria stay explicit in the roadmap.

The installed IDM command-line workflow yielded no request/output in two attempts; the comparison remains pending. Native SSO beyond Windows NTLM/Docker Linux Kerberos, managed proxy policies, filesystem coverage beyond the documented image matrix and release/browser acceptance are not inferred from fixture success.

From this increment onward, each focused commit increments `0.MINOR.PATCH` and updates README/roadmap/changelog together; major remains 0 until complete parity. Historical commits are preserved for reversibility.
