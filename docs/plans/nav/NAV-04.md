# NAV-04: durable waits and readiness

## Outcome and baseline

Recover waits after worker restart, browser restart, sleep and clock changes, then revalidate readiness in the owning session. Existing content-script loops poll once per second and stop after a ten-minute navigation budget; they do not establish durable timer/session recovery.

Owner: batch C. Dependencies: NAV-05 adapter wait signals, NAV-10 queue admission and NAV-11 scope. Own wait modules and scheduler fixtures.

## Implementation increments

1. Define typed wait metadata: source generation, observed duration/deadline, server/local basis, next recheck, expiry policy, and whether the host requires a live tab. Persist only nonsecret metadata.
2. Use extension alarms and the service scheduler for durable wakeups; use monotonic elapsed time during a live process and UTC deadlines for restart recovery. A wakeup always revalidates the server/page state before declaring ready.
3. Keep a tab alive for session/timer-dependent hosts. Permit tab suspension/recreation only where the adapter has a passing fixture proving continuation works; otherwise expose the reason the tab remains open.
4. Separate active-step timeouts from legitimate long waits. Retain bounded rechecks, Retry-After handling and user cancellation; avoid duplicate final submissions after repeated alarm events.
5. Notify once per readiness generation after actual readiness, using local desktop/extension permission-aware controls. Add waiting reason/deadline, Continue/Cancel and sleep/restart recovery states.

## Tests and acceptance

- Fake-clock fixtures cover sleep past deadline, backward/forward jumps, restart, delayed alarms, expired token, replaced countdown, multiple timers, hidden timers and repeated ready events.
- A server-enforced fixture rejects premature requests; implementation submits only when server readiness is confirmed.
- Tab-required and tab-recreatable fixtures each recover correctly; a stale tab/session becomes scoped user action rather than fabricated readiness.
- Notification denial does not break waiting, and cancellation removes pending alarms and host reservations.

## Research boundary

Instant download may use a provider-supported entitled/API mechanism once qualified. Do not pretend a locally elapsed timer removes server requirements. No generalized timer bypass is a completion criterion. See [execution requirements](README.md).
