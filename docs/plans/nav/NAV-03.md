# NAV-03: existing premium entitlements

## Outcome and baseline

Use an existing entitled browser session to select the intended premium download path and preserve account limits, expiry and source ownership. Owner chose browser sessions first; provider APIs follow individual qualification. Existing generic policy excludes premium controls, so entitlement-aware selection must be separate and explicit.

Owner: batch D. Dependencies: NAV-02 accounts, NAV-05/06 adapters, NAV-09 replay policy and NAV-11 session isolation.

## Implementation increments

1. Extend account/provider metadata with adapter-observed entitlement state and last validation time. Treat stale/unknown entitlement as unknown; a page label alone cannot authorize purchase or claim account status.
2. Provide explicit account/session and free/premium mode selection for qualified providers. NAV-05 may select a premium control only when the selected provider adapter validates the chosen entitled session.
3. Resolve fresh premium sources within that session; preserve g4u's selected downstream host and original provenance. Respect quota/rate/account errors and request replay disposition from NAV-09 before probing or starting another request.
4. Handle login expiry, entitlement expiry, exhausted quota and mismatched account with typed recovery; offer another selected account or the free/manual path. No automatic account hopping or payment submission.
5. Publish provider-specific browser-session acceptance. Document official API feasibility separately, including current documentation, authentication, limits and permitted use; implement an API only after it has its own accepted contract and tests.

## Tests and acceptance

- Fixtures distinguish active/expired/unknown entitlement, quota exhaustion, wrong account, competing profiles, premium ads and purchase controls.
- Each supported path downloads the intended permitted file with an expected hash; premium labels/buttons alone are not success.
- Account/session selection persists only nonsecret references and invalidates stale in-flight results.
- UI states clearly identify selected session, unknown entitlement, needed login and any payment step without submitting a payment.

## Research boundary

Premium-access bypass remains a separate feasibility item requiring a provider-supported or explicitly authorized approach. Existing browser-session support does not close that research sub-scope. Do not implement a guessed bypass or claim unpaid access. See [execution requirements](README.md).
