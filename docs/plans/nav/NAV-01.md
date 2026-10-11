# NAV-01: existing FlareSolverr qualification

## Outcome and baseline

Qualify the remaining browser-challenge and visible-control behavior without rebuilding the implemented adapter. Main 0.5.5 already has loopback configuration/testing, owned temporary sessions, scoped cookies/User-Agent, automatic/manual attempts, bounded GET traversal, and controlled hash-verified transfers. Real Cloudflare clearance and the live host/browser matrix remain open.

Owner: batch E. Dependencies: shared contracts; NAV-06 matrix, NAV-10 scheduling and NAV-11 session scope for final integration. Custom image CAPTCHA belongs to NAV-13.

## Implementation increments

1. Extend `scripts/qualify-solver.mjs` through batch-owned qualification helpers, reusing existing fixtures and evidence schema. Distinguish service health, challenge clearance, source extraction, engine viability, final hash verification, and completion.
2. Exercise actual desktop enable/save/test/disable/manual-retry controls and extension Continue/Try FlareSolverr. Check stale-setting invalidation, cancellation, cleanup failure, service restart, Direct routing, private-session refusal, and actionable errors.
3. Run permitted live source/downstream cases for g4u, ddownload, Rapidgator, and Gofile. Identify which pages actually contain a browser challenge. Do not count ordinary HTTP 200, a rendered DOM, or `status: ok` as clearance.
4. Repair concrete defects with regression fixtures; publish the host/browser matrix, scope, and remaining cases. Preserve current automatic-attempt limits unless a tested adapter explicitly changes them.

## Tests and acceptance

- Existing core/solver/transfer/bridge fixtures pass; browser snapshots/events contain no headers, images, credentials, session secrets, or local paths.
- A supported challenge case must demonstrate clearance and a fresh usable source; an end-to-end row must additionally finish the expected file hash.
- An unsupported custom CAPTCHA, sign-in requirement, or expired link produces the correct typed recovery and zero false desktop completion.
- Capture visible native/extension controls and exact tested browser versions. Cross-platform acceptance requires actual target evidence; document unavailable rows as pending.

## Delivery boundary

Qualification can add implementation fixes but cannot claim every host works. If a live challenge cannot be reproduced with a permitted fixture, leave its row open and publish the reason. No billable solver calls are authorized. See [shared execution requirements](README.md).
