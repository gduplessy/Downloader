# HTTP-date parser compatibility

## Contract and primary sources

The navigation Retry-After parser accepts the three HTTP-date forms in [RFC9110 section5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7). Calendar, weekday and time semantics follow its reference to [RFC5322 section3.3](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.3). Official text was inspected with the gstack browser on2026-10-16 and cached in the task-local `.local` directory; the documentation browser was stopped normally afterward.

- IMF-fixdate keeps exact capitalization, fixed field widths and GMT.
- RFC850 uses the long weekday and two-digit year. The injected observation clock supplies a rolling fifty-year boundary. The entire candidate timestamp is compared; a value beyond the boundary moves to the most recent preceding century with the same final two year digits. Weekday/calendar validation applies after that interpretation. Tests cover the exact boundary, one second beyond it and a century transition.
- Asctime uses UTC and accepts its two-digit day or space-padded one-digit day. It does not accept an added timezone suffix.
- All forms reject invalid weekdays, calendar rollovers, years before1900, invalid time fields, mixed capitalization, extra internal whitespace, control delimiters and oversized input. Parsing does not delegate to implementation-dependent Date.parse.
- RFC9110 includes a leap-second value. A23:59:60 input validates its stated date/weekday against23:59:59 and maps to the following UTC boundary because JavaScript epoch milliseconds cannot represent the inserted second separately. Other minute/hour positions with second60 are rejected. This is a conservative scheduling representation, not a leap-insertion calendar service or evidence of future leap announcements.

## Scheduling and ownership limits

The existing128-character input ceiling, decimal delay-seconds behavior, nonnegative/safe-integer deadline and seven-day scheduling ceiling remain enforced by `retryAfter`. A valid obsolete timestamp does not bypass exact request, committed-document, session, source or claim authority. Header integration tests ingest each obsolete form through the production observer and reject a replacement document and duplicate response.

Deterministic parser/observer/wait tests pass70/70. No installed browser or live provider qualification for obsolete date strings is claimed; existing installed date503 records use IMF-fixdate. Sleep, restart, private, Firefox, other OS and live-provider acceptance boundaries remain as recorded separately.
