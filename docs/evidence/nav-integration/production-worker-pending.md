# Production worker acceptance: pending

Latest checked integration base: `093a447` (0.8.12).

The isolated Windows Chrome fixture builds the production background worker and resolver, substitutes a unique native-host name, and adds diagnostic-only logging to otherwise swallowed errors. It grants loopback fixture permissions and uses a minimal trusted options-page driver. It does not qualify the actual options UI or permission prompt.

The latest run, `.fixture-streams/production-worker-1791758726409`, terminated with an assertion failure. Its native navigation job was correctly claimed as a browser source with an explicit Chromium scope, but remained `waiting_browser`, received zero bytes, and submitted zero POST requests.

The diagnostic console reported repeatedly:

> Error: PartitionKey requested is not serializable.

Next investigation: identify the actual tab/frame and call path producing the Chromium partition-key error. Preserve explicit cookie-store and partition authority; do not substitute a default or fabricated partition to make the fixture pass. Then rerun the original one-use POST and verified desktop file hash gate.

The separately qualified Chrome/Edge stream-module hashes bypass the production background/resolver and do not prove this pending end-to-end gate. Blob, cancellation, source/document replacement, private/container, Firefox, and complete account/challenge/discovery installed flows also remain separate acceptance work.

The attempted follow-up live diagnostic was not executed because automatic approval review could not complete after the account usage limit was reached. This was not an unsafe-action finding. All three active agents were also interrupted by the usage limit; resume their saved worktrees rather than recreating them.

## Subsequent confirmation: first POST gate passed

Candidate 0.8.13 fixed mutable indexing of null incremental snapshots and qualified cached cursors by exact visible authority. The default runner then passed in `.fixture-streams/production-worker-1791762500369`: installed Chrome 155.0.8059.39, one original POST, 262,161 bytes, nativecomplete, SHA-256 ea7079c478bfa028ecbe546e3f39bbf22aa9e5a5d575fd3854105c3c05d6a862, diagnosticSourceChanges=false. Earlier partition errors were incidental; direct actual top-frame calls succeeded. The broader acceptance matrix listed above remains pending.
