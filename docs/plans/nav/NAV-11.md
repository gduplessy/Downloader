# NAV-11: session boundary qualification and repairs

## Outcome and baseline

Prove owner claims cover the intended browser profile, private context, cookie store/container and partition. Repair defects found by the matrix. Current profile UUID and store selection are partial; requests are primarily indexed by URL, which risks ambiguity across simultaneous contexts.

Owner: batch B. Dependencies: shared session/claim contract; other NAV workflows must consume that scope.

## Implementation increments

1. Implement `SessionScope` and request correlation keyed by browser request/tab/frame/document identity and session scope, not URL alone. Resolve the appropriate cookie store/top-level partition explicitly; absent context cannot silently read a default profile.
2. Add fenced claim generations and explicit user transfer. Old workers cannot report progress, supply cookies, submit challenges or write stream bytes after another scope acquires ownership.
3. Restore task-owned tabs in the original container/private context or stop for explicit reauthorization. Never reopen a private/container task in a default normal tab.
4. Keep secrets in memory or supported ephemeral session storage. Persist only needed nonsecret task metadata; test storage/events/exports/logs. Private work must not leave durable URLs, filenames or session details after its defined lifecycle; define necessary transient download state explicitly.
5. Qualify ordinary/partitioned cookies, private profiles, Firefox containers, competing workers, worker suspend/restart, browser/native restart and ownership transfer using isolated fixture profiles.
6. Publish feature-by-browser scope capabilities and exact privacy limitations. Missing cookie/container API must produce a blocked/manual scoped path rather than session substitution.

## Tests and acceptance

- Identical URL/cookie names in two profiles, two containers, normal/private windows and two top-level partitions receive different expected hashes with no cross-context bytes.
- Stale/forced claims and worker races reject late status/resolve/stream/challenge submissions. Pending handoff recovery remains scoped.
- Inspect service DB, event journal, extension local/session storage, diagnostics and exported lists for fixture secret markers.
- Actual Chrome/Edge stable and Firefox stable/ESR runs record permission configuration and OS; mocked cookie APIs alone do not establish qualification.

See [shared execution requirements](README.md).
