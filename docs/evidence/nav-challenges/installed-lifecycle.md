# Installed NAV-13 lifecycle qualification

Current work is pending, not passing acceptance. The production challenge modules and authorization are unchanged. The installed driver builds production entrypoints, substitutes a unique fixture native-host address, pregrants loopback permissions and copies a full-hash-verified immutable native service/CLI pair built from 3b808ae1967a210fc5b3a3e461488b9f2ab6cb61 (0.25.1). Both copied executable hashes are checked before launch.

## Cases

Run from the repository root with NAV_BROWSER pointing to the actual Chrome or Edge executable and NAV_CHALLENGE_CASE set to fresh, cancel, csrf, image or selected-host. Then run node scripts/nav-fixtures/challenges/installed.mjs. Every invocation creates isolated native registration, browser profile, state and destination. Production permission prompts are outside this pregranted fixture.

- fresh requires four original CAPTCHA submissions, selected gofile.io provenance and four desktop SHA256 matches.
- cancel requires actual production Cancel, dialog dismissal, zero POSTs and zero transferred bytes.
- csrf, image and selected-host mutate only the original fixture page, then use actual Solve locally. They require explicit stale refusal, zero POSTs and zero transferred bytes. These page mutations model hostile replacement; they do not substitute worker authorization or session context.

## Retained unsuccessful attempts

On Windows/Edge, initial 8fec82d omitted the webNavigation pregrant newly required by current production and activation refused with a user-gesture error. This was a fixture precondition failure.

The corrected-permission attempt submitted one accepted original g4u challenge for gofile.io, but downstream selection remained WaitingUser with zero bytes. A later fresh attempt submitted zero challenges and could not find its fresh result page. Neither attempt establishes downstream acceptance. Concurrent resolver-generation invalidation is being investigated separately; this document does not assign a cause without exact evidence.

Exact commit 28b4ea77c4119bf85acdfb68fb871082d0000861 ran the installed Edge CSRF case and observed zero original submissions. The driver incorrectly searched for the stale message as the accessibility status node name; its text may be a StaticText descendant. The strict assertion failed and this attempt is not accepted. The corrected observer requires the same exact visible text anywhere in the nonignored accessibility tree and saves the raw tree before asserting. A completed repeat is still required.

## Boundaries

Installed Firefox, claim-generation races, late-result cancellation, true selected-host context replacement and native desktop-window controls remain pending. Mutating a hidden host field proves only form-binding refusal. No live provider/account or paid-provider requests occur; budget and opt-in remain zero/off. The existing renderer mocks and unit tests remain separate evidence.
