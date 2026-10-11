# NAV-10: configurable host-aware navigation queue

## Outcome and baseline

Make admission, backlog and host/session locks explicit and recoverable. Current `navigationAvailable()` enforces three pages and one per original page host, and polling silently skips blocked jobs.

Owner: batch C. Dependencies: shared contracts, NAV-05 host-lock declarations and NAV-11 session scope; NAV-04 waits share the scheduler.

## Implementation increments

1. Add validated navigation settings: default three active tabs, allowed range one through twenty; global/per-host policies and queue ordering. Session-sensitive workflows retain one active task per host lock regardless of global limit.
2. Keep a service-owned durable backlog/order and lease metadata; extension workers request admission rather than independently racing local lists. A host lock may span redirect/downstream hops or whole-site CAPTCHA invalidation, as declared by the adapter.
3. Separate global tab slots, host/session reservations and waiting/manual/streaming states. Document which waits retain a tab/lock and when a task can release/reacquire safely. Avoid permanently starving other hosts behind a blocked job.
4. Reconcile live tabs, owners and task generations after restart/sleep. Expire orphaned leases conservatively, fencing prior owners before reassignment. Cancellation closes only task-owned tabs and releases reservations.
5. Expose queued order, wait reason, active/limit counts, priority/reorder and pause/resume controls. Lowering the limit prevents new admission without interrupting already active transfers.
6. Higher same-host concurrency remains disabled until an adapter/session combination passes isolation and host-limit fixtures; global twenty is not permission for twenty competing CAPTCHA sessions.

## Tests and acceptance

- Fifty-job deterministic queue, fair interleaving across hosts, default/one/twenty limits, invalid settings, dynamic limit changes and duplicate admissions.
- Redirect into a busy host, shared CAPTCHA-site lock, manual wait, cancelled head job, worker/browser restart, stale owner and lease expiry.
- No global/host cap violation, unintended session mixing or orphaned live tab after recovery. Every blocked job displays a typed reason.
- Measure resource behavior at configured limits on actual browsers; publish the tested bound and limitations.

See [shared execution requirements](README.md).
