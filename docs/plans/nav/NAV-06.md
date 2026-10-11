# NAV-06: host qualification and adapter maintenance

## Outcome and baseline

Publish actionable support per host/workflow/browser and keep it reproducible as layouts change. Current evidence has controlled hosted GET/POST and FlareSolverr fixtures; it does not qualify changing live hosts.

Owner: batch A. Dependencies: NAV-05 registry; feature owners supply streaming, login, wait and challenge capabilities. Target hosts: g4u, ddownload, Rapidgator and Gofile.

## Implementation increments

1. Add a host matrix keyed by adapter/version, workflow, browser/version, OS, test date/revision, outcome, reason and recovery. Separate synthetic, recorded-layout and live end-to-end evidence. Expired evidence is not current support.
2. Create sanitized HTML/DOM fixtures and a local fixture server for chosen-host panels, GET links/forms, POST, one-use tokens, redirects, countdowns, login/premium state, custom CAPTCHA and deliberate layout changes.
3. Implement fixture-backed initial adapters only for observed permitted layouts. Document unsupported/unobserved cases; placeholders do not become host-support claims.
4. Add contribution schema, adapter validation, maintenance ownership, capability tests and disable/fallback policy. Feature tests must check intended request/file outcomes, not only selectors.
5. Provide an opt-in live-smoke command for supplied permitted files and locally configured accounts. Bound host concurrency and requests; collect sanitized outcomes. Ordinary CI uses deterministic fixtures, not live providers.

## Tests and acceptance

- All four hosts have explicit matrix rows, even when unavailable/unqualified; every supported row links reproducible evidence and exact adapter revision.
- Layout mutation, missing controls, host change, login/paywall, countdown and expiry fixtures produce safe supported action or explicit manual recovery.
- Passing end-to-end rows verify the intended hash and selected-host provenance; screenshot resemblance alone is insufficient.
- Run existing extension/transfer/solver regressions and new adapter fixtures with no private signed URLs or cookies in logs/artifacts.

## Inputs and boundaries

Fresh permitted files, selected-host links and account access are needed for live qualification. Historical g4u research is context, not current live evidence. Use gstack `/browse` for current provider documentation and visible live checks. See [execution requirements](README.md).
