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

## Prepared Firefox driver

`scripts/nav-fixtures/challenges/installed-firefox.mjs` prepares an actual Firefox MV2 addon from production modules, uses BiDi pointer input and read-only privileged closed-shadow inspection, and compares actual tab/store/profile ownership with the native job. Set NAV_NATIVE_BINARY and NAV_CLI_BINARY to the immutable 0.25.1 pair and NAV_NATIVE_REVISION to 3b808ae1967a210fc5b3a3e461488b9f2ab6cb61; both full copied executable hashes are enforced. Set NAV_CHALLENGE_CASE to fresh, cancel, csrf, image or selected-host. NAV_PREPARE_ONLY=1 verifies bundling/native hashes and exits before starting a daemon or browser.

Preparation-only bundling passed. A local HTTP contract check submitted the original synthetic challenge, verified selected gofile.io result HTML with its permitted preparation control, and fetched the exact SHA256 payload used by the original-page Blob path. This does not establish browser acceptance. The fresh lane uses original-page fetch to Blob plus the production direct desktop stream; Firefox binary navigation capture remains explicitly pending. No browser was launched during this preparation increment.

At exact `f16b9f6`, installed Edge CSRF again recorded zero submissions but failed the fixed 1500ms refusal snapshot. The actual accessibility tree contained the dialog with an empty status. This proves neither explicit refusal nor a cause for the blank state. Version0.33.9 waits up to45s for the identical exact visible refusal, while checking zero submissions throughout; the corrected installed repeat remains pending.

The b92cbb5 Edge CSRF repeat observed one rejected original POST before refusal and failed the zero-submit gate. Inspection found the driver mutated CSRF immediately after clicking asynchronous host selection, before the bound Solve locally panel existed; production captures its initial binding before publishing that panel. Version0.33.10 waits for the actual bound panel before mutation, preserving the same refusal and zero-POST assertions. Qualification still requires a passing repeat.

All four corrected negative cases passed in installed Edge155 Windows at exact `35ed666` (0.33.10): actual Cancel, changed CSRF, replaced image and hidden-host form mutation. Each recorded zero original submissions, WaitingUser with zero bytes, and exact visible refusal or dialog dismissal. Each fixture process exited0; the final three-case sequential command also exited0. The four committed records retain native/service and compiled/source fingerprints. This closes only these four Edge regular-profile synthetic negatives; fresh delivery, Firefox, true session-host replacement and other boundaries remain pending.

The first actual Firefox CSRF invocation at854fe6d failed before browser launch: a later block-scoped identity variable named profile shadowed the outer profile directory and caused a temporal-dead-zone ReferenceError. Version0.33.12 renames the identity variable; syntax/preparation had not exposed this runtime-only fixture defect. No Firefox acceptance is claimed until a complete installed repeat passes.
